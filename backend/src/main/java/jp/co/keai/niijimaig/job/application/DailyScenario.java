package jp.co.keai.niijimaig.job.application;

import org.springframework.stereotype.Service;

import jp.co.keai.niijimaig.connection.application.TokenRenewal;

/**
 * シナリオ「daily（日本時間 4:00）」: 稼働記録 → トークンを更新する →（フェーズ4: インサイト・ネタ収集）→ 稼働記録。
 * トークンの期限が迫って更新に失敗したら、他の処理を終えてから失敗を返す（ワークフローを失敗させる）。
 */
@Service
public class DailyScenario {

	static final String WORKFLOW = "daily";

	private final BatchHeartbeatRepository heartbeats;
	private final TokenRenewal tokenRenewal;

	public DailyScenario(BatchHeartbeatRepository heartbeats, TokenRenewal tokenRenewal) {
		this.heartbeats = heartbeats;
		this.tokenRenewal = tokenRenewal;
	}

	/** @return ワークフローを成功で終えてよいなら true */
	public boolean run(String runId) {
		heartbeats.started(WORKFLOW, runId);
		boolean failWorkflow = tokenRenewal.run();
		heartbeats.finished(WORKFLOW, runId);
		return !failWorkflow;
	}
}
