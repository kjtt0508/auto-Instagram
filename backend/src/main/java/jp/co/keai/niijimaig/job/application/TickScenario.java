package jp.co.keai.niijimaig.job.application;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.function.Consumer;

import org.springframework.stereotype.Service;

import jp.co.keai.niijimaig.job.domain.JobType;
import jp.co.keai.niijimaig.post.application.MediaPreparation;
import jp.co.keai.niijimaig.post.application.PostPublishing;

/**
 * シナリオ「tick（15分ごと）」: 稼働記録 → 期限切れジョブの回収 → 新しい予約にジョブを積む →
 * 公開用画像の準備 → 公開 → 稼働記録（REQ-001.md 6.1）。持ち時間を超えそうならジョブを取らずに終わる。
 */
@Service
public class TickScenario {

	static final Duration BUDGET = Duration.ofMinutes(8);
	static final Duration RESERVE_FOR_PUBLISH = Duration.ofMinutes(2);
	static final String WORKFLOW = "tick";

	private final BatchHeartbeatRepository heartbeats;
	private final JobRecovery recovery;
	private final JobRepository jobs;
	private final MediaPreparation preparation;
	private final PostPublishing publishing;
	private final Clock clock;

	public TickScenario(BatchHeartbeatRepository heartbeats, JobRecovery recovery, JobRepository jobs,
			MediaPreparation preparation, PostPublishing publishing, Clock clock) {
		this.heartbeats = heartbeats;
		this.recovery = recovery;
		this.jobs = jobs;
		this.preparation = preparation;
		this.publishing = publishing;
		this.clock = clock;
	}

	public void run(String runId) {
		Instant deadline = clock.instant().plus(BUDGET);
		heartbeats.started(WORKFLOW, runId);
		recovery.run();
		jobs.enqueueForNewSchedules();
		drain(JobType.PREPARE_MEDIA, runId, deadline.minus(RESERVE_FOR_PUBLISH), preparation::run);
		drain(JobType.PUBLISH_POST, runId, deadline, publishing::run);
		heartbeats.finished(WORKFLOW, runId);
	}

	private void drain(JobType type, String runId, Instant until, Consumer<ClaimedJob> work) {
		while (clock.instant().isBefore(until)) {
			Optional<ClaimedJob> claimed = jobs.claim(type, runId);
			if (claimed.isEmpty()) {
				return;
			}
			runSafely(claimed.get(), work);
		}
	}

	/**
	 * 1件の想定外の失敗で tick 全体を止めない。ジョブは実行中のまま残り、実行期限が過ぎたら回収される。
	 * ログには ID と例外の種類だけを出す（公開リポジトリのため本文・秘密情報を出さない）。
	 */
	private void runSafely(ClaimedJob claimed, Consumer<ClaimedJob> work) {
		try {
			work.accept(claimed);
		} catch (RuntimeException e) {
			LOG.error("job {} ({}) failed unexpectedly: {}", claimed.job().id(), claimed.job().type(), e.getClass().getSimpleName());
		}
	}

	private static final org.slf4j.Logger LOG = org.slf4j.LoggerFactory.getLogger(TickScenario.class);
}
