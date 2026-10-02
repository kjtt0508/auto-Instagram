package jp.co.keai.niijimaig.job.application;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import jp.co.keai.niijimaig.job.domain.Job;
import jp.co.keai.niijimaig.job.domain.JobType;

/** ジョブ（予定表）の記録。状態とロックは UPDATE、試行の結果は追記（ADR-0006） */
public interface JobRepository {

	/** 予約の確定（承認・再実行）のうち、まだジョブが無いものに、公開用画像の準備と公開のジョブを積む */
	int enqueueForNewSchedules();

	/** 実行権を取る（期限付き）。取れなければ空 */
	Optional<ClaimedJob> claim(JobType type, String runner);

	/** 実行期限を過ぎた実行中のジョブ */
	List<ClaimedJob> expiredRunning();

	/** 試行を終える。次に待機に戻すなら runAgainAt に再実行の時刻 */
	void finish(ClaimedJob claimed, Job next, AttemptOutcome outcome, Instant runAgainAt);
}
