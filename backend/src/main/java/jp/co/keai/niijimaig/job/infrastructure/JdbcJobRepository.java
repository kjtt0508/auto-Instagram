package jp.co.keai.niijimaig.job.infrastructure;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionTemplate;

import jp.co.keai.niijimaig.job.application.AttemptOutcome;
import jp.co.keai.niijimaig.job.application.ClaimedJob;
import jp.co.keai.niijimaig.job.application.JobRepository;
import jp.co.keai.niijimaig.job.domain.Job;
import jp.co.keai.niijimaig.job.domain.JobStatus;
import jp.co.keai.niijimaig.job.domain.JobType;

/**
 * ジョブ（予定表）。状態とロックは UPDATE する（harness-allow: P18 ADR-0006）。試行の結果は追記。
 * 重複防止の鍵は JobType.dedupeKey と同じ形（種別:投稿ID:予約の確定ID）。
 */
@Repository
public class JdbcJobRepository implements JobRepository {

	private static final String ENQUEUE = """
			insert into jobs (tenant_id, job_type, post_id, dedupe_key, run_at, status, max_attempts)
			select p.tenant_id, ?, s.post_id, concat(?::text, ':', s.post_id, ':', s.id),
			       case when ? then s.scheduled_at else now() end, 'PENDING', ?
			  from post_schedules s
			  join posts p on p.id = s.post_id
			  join post_current pc on pc.post_id = s.post_id
			 where pc.status = 'SCHEDULED'
			   and s.id = (select max(id) from post_schedules latest where latest.post_id = s.post_id)
			on conflict (dedupe_key) do nothing
			""";

	private static final Map<JobStatus, String> OUTCOME = Map.of(
			JobStatus.SUCCEEDED, "SUCCEEDED", JobStatus.FAILED, "FAILED", JobStatus.PENDING, "RETRY");

	private final JdbcTemplate jdbc;
	private final TransactionTemplate tx;

	public JdbcJobRepository(JdbcTemplate jdbc, TransactionTemplate tx) {
		this.jdbc = jdbc;
		this.tx = tx;
	}

	@Override
	public int enqueueForNewSchedules() {
		return enqueue(JobType.PREPARE_MEDIA, false) + enqueue(JobType.PUBLISH_POST, true);
	}

	private int enqueue(JobType type, boolean atScheduledTime) {
		return jdbc.update(ENQUEUE, type.name(), type.name(), atScheduledTime, type.maxAttempts());
	}

	@Override
	public Optional<ClaimedJob> claim(JobType type, String runner) {
		return jdbc.query("select * from app.claim_next_job(?, make_interval(secs => ?), ?)",
				(rs, i) -> toClaimed(rs), type.name(), type.lockDuration().toSeconds(), runner).stream().findFirst();
	}

	@Override
	public List<ClaimedJob> expiredRunning() {
		return jdbc.query("select * from jobs where status = 'RUNNING' and locked_until < now()", (rs, i) -> toClaimed(rs));
	}

	@Override
	public void finish(ClaimedJob claimed, Job next, AttemptOutcome outcome, Instant runAgainAt) {
		tx.executeWithoutResult(status -> {
			jdbc.update("""
					insert into job_attempt_results (job_attempt_id, outcome, error_kind, error_detail, in_job_retries)
					values (?, ?, nullif(?, ''), nullif(?, ''), ?) on conflict (job_attempt_id) do nothing
					""", claimed.attemptId(), OUTCOME.get(next.status()), outcome.errorKind(), outcome.errorDetail(),
					outcome.inAttemptRetries());
			jdbc.update("""
					update jobs set status = ?, locked_until = null,
					       run_at = case when ? = 'PENDING' then ? else run_at end
					 where id = ? and status = 'RUNNING'
					""", next.status().name(), next.status().name(), Timestamp.from(runAgainAt), claimed.job().id());
		});
	}

	private ClaimedJob toClaimed(ResultSet rs) throws SQLException {
		UUID jobId = rs.getObject("id", UUID.class);
		int attempts = rs.getInt("attempts");
		Job job = new Job(jobId, JobType.valueOf(rs.getString("job_type")), JobStatus.valueOf(rs.getString("status")),
				new Job.Attempts(attempts, rs.getInt("max_attempts")));
		Long attemptId = jdbc.queryForObject("select id from job_attempts where job_id = ? and attempt_no = ?",
				Long.class, jobId, attempts);
		return new ClaimedJob(job, attemptId, Optional.ofNullable(rs.getObject("post_id", UUID.class)));
	}
}
