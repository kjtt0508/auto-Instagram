package jp.co.keai.niijimaig.job.domain;

import java.time.Instant;
import java.util.UUID;

/**
 * ジョブ: 定期処理が行う1件の仕事。同じ仕事は同時に1つの処理しか実行しない（実行権は DB の claim_next_job で取る）。
 * 実行期限を過ぎた実行中ジョブは、試行回数が残っていれば待機に戻す。
 */
public final class Job {

	private final UUID id;
	private final JobType type;
	private final JobStatus status;
	private final Attempts attempts;

	public Job(UUID id, JobType type, JobStatus status, Attempts attempts) {
		if (id == null || type == null || status == null || attempts == null) {
			throw new IllegalArgumentException("ジョブID・種別・状態・試行回数は必須");
		}
		this.id = id;
		this.type = type;
		this.status = status;
		this.attempts = attempts;
	}

	public Job succeeded() {
		return withStatus(JobStatus.SUCCEEDED);
	}

	/** 失敗した。試行回数が残っていれば次の定期処理で再試行（待機に戻す） */
	public Job failedOrRetry() {
		if (attempts.exhausted()) {
			return withStatus(JobStatus.FAILED);
		}
		return withStatus(JobStatus.PENDING);
	}

	/**
	 * 仕事は進んだが、持ち時間の都合で続きを次の定期処理に回す。この試行は回数に数えない
	 * （claim で数えた1回ぶん、上限を増やして待機に戻す。進んだ試行を数えると、数枚ずつしか進められない仕事が途中で失敗になる）
	 */
	public Job deferred() {
		return new Job(id, type, status.transitTo(JobStatus.PENDING), attempts.extended());
	}

	/** 再試行しても結果が変わらない失敗（連携切れ・内容の不備など） */
	public Job failedFinally() {
		return withStatus(JobStatus.FAILED);
	}

	/** 実行期限切れの回収。中断した処理の扱いは、失敗か再試行かで変わる */
	public Job recoverExpired() {
		return failedOrRetry();
	}

	public boolean isFinallyFailed() {
		return status == JobStatus.FAILED;
	}

	public boolean willRetry() {
		return status == JobStatus.PENDING;
	}

	/** 試行回数の上限（持ち越した試行は数えないぶん、上限が増える） */
	public int maxAttempts() {
		return attempts.max();
	}

	public UUID id() {
		return id;
	}

	public JobType type() {
		return type;
	}

	public JobStatus status() {
		return status;
	}

	private Job withStatus(JobStatus next) {
		return new Job(id, type, status.transitTo(next), attempts);
	}

	/** 試行回数（何回目か / 最大） */
	public record Attempts(int done, int max) {
		public Attempts {
			if (max < 1 || done < 0 || done > max) {
				throw new IllegalArgumentException("試行回数は0以上・最大以下: " + done + "/" + max);
			}
		}

		boolean exhausted() {
			return done >= max;
		}

		Attempts extended() {
			return new Attempts(done, max + 1);
		}
	}
}
