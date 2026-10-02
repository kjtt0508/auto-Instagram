package jp.co.keai.niijimaig.job.infrastructure;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import jp.co.keai.niijimaig.job.application.BatchHeartbeatRepository;

@Repository
public class JdbcBatchHeartbeatRepository implements BatchHeartbeatRepository {

	private final JdbcTemplate jdbc;

	public JdbcBatchHeartbeatRepository(JdbcTemplate jdbc) {
		this.jdbc = jdbc;
	}

	@Override
	public void started(String workflow, String runId) {
		record(workflow, runId, "STARTED");
	}

	@Override
	public void finished(String workflow, String runId) {
		record(workflow, runId, "FINISHED");
	}

	private void record(String workflow, String runId, String phase) {
		jdbc.update("insert into batch_heartbeats (workflow, run_id, phase) values (?, ?, ?) on conflict do nothing",
				workflow, runId, phase);
	}
}
