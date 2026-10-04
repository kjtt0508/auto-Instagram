package jp.co.keai.niijimaig.job.application;

import org.springframework.stereotype.Service;

import jp.co.keai.niijimaig.connection.application.TokenRenewal;
import jp.co.keai.niijimaig.image.application.CandidateCleanup;

/**
 * シナリオ「daily（日本時間 4:00）」: 稼働記録 → トークンを更新する → 放置された候補を消す →（フェーズ4: インサイト・ネタ収集）→ 稼働記録。
 * トークンの期限が迫って更新に失敗したら、他の処理を終えてから失敗を返す（ワークフローを失敗させる）。
 */
@Service
public class DailyScenario {

	static final String WORKFLOW = "daily";

	private final BatchHeartbeatRepository heartbeats;
	private final TokenRenewal tokenRenewal;
	private final CandidateCleanup candidateCleanup;

	public DailyScenario(BatchHeartbeatRepository heartbeats, TokenRenewal tokenRenewal, CandidateCleanup candidateCleanup) {
		this.heartbeats = heartbeats;
		this.tokenRenewal = tokenRenewal;
		this.candidateCleanup = candidateCleanup;
	}

	/** @return ワークフローを成功で終えてよいなら true */
	public boolean run(String runId) {
		heartbeats.started(WORKFLOW, runId);
		boolean failWorkflow = tokenRenewal.run();
		candidateCleanup.run();
		heartbeats.finished(WORKFLOW, runId);
		return !failWorkflow;
	}
}
