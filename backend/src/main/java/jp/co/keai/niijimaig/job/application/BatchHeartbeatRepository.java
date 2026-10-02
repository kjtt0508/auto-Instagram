package jp.co.keai.niijimaig.job.application;

/** バッチ稼働記録（定期処理が動いたことの記録）。止まっていることの検知に使う */
public interface BatchHeartbeatRepository {

	void started(String workflow, String runId);

	void finished(String workflow, String runId);
}
