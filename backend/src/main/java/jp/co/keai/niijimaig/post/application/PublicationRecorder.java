package jp.co.keai.niijimaig.post.application;

import java.time.Clock;
import java.time.Duration;

import jp.co.keai.niijimaig.job.application.AttemptOutcome;
import jp.co.keai.niijimaig.job.application.ClaimedJob;
import jp.co.keai.niijimaig.job.application.JobRepository;
import jp.co.keai.niijimaig.job.domain.Job;
import jp.co.keai.niijimaig.post.domain.FailureKind;
import jp.co.keai.niijimaig.post.domain.FailureReason;
import jp.co.keai.niijimaig.post.domain.Post;
import jp.co.keai.niijimaig.post.domain.PostRepository;

/** 公開を試みた結果を、投稿の出来事とジョブの試行結果として記録する */
final class PublicationRecorder {

	static final Duration NEXT_TICK = Duration.ofMinutes(15);

	private final PostRepository posts;
	private final JobRepository jobs;
	private final Clock clock;

	PublicationRecorder(PostRepository posts, JobRepository jobs, Clock clock) {
		this.posts = posts;
		this.jobs = jobs;
		this.clock = clock;
	}

	void record(ClaimedJob claimed, Post publishing, PublicationResult result, int retries) {
		switch (result.outcome()) {
			case PUBLISHED -> published(claimed, publishing, result, retries);
			case DEFERRED -> deferred(claimed, publishing, result.reason(), retries);
			case FAILED -> failed(claimed, publishing, result.reason(), claimed.job().failedFinally(), retries);
			case STILL_PROCESSING -> stillProcessing(claimed, publishing, retries);
		}
	}

	/** Instagram の処理待ち: 公開処理中のまま次の定期処理で続ける。試行回数が尽きたら人に確認を頼む */
	private void stillProcessing(ClaimedJob claimed, Post publishing, int retries) {
		Job next = claimed.job().failedOrRetry();
		if (next.isFinallyFailed()) {
			failed(claimed, publishing, FailureReason.of(FailureKind.UNKNOWN), next, retries);
			return;
		}
		retryLater(claimed, next, AttemptOutcome.error("STILL_PROCESSING", "Instagram の処理待ち", retries));
	}

	private void published(ClaimedJob claimed, Post publishing, PublicationResult result, int retries) {
		posts.recordPublished(publishing, publishing.published(), result.publishResult());
		jobs.finish(claimed, claimed.job().succeeded(), AttemptOutcome.success(retries), clock.instant());
	}

	/** 上限超過: 試行回数が残っていれば予約中に戻して次の定期処理へ。尽きたら失敗 */
	private void deferred(ClaimedJob claimed, Post publishing, FailureReason reason, int retries) {
		Job next = claimed.job().failedOrRetry();
		if (next.isFinallyFailed()) {
			failed(claimed, publishing, reason, next, retries);
			return;
		}
		posts.record(publishing, publishing.deferred(reason));
		retryLater(claimed, next, AttemptOutcome.error(reason.kind().name(), "", retries));
	}

	private void failed(ClaimedJob claimed, Post publishing, FailureReason reason, Job next, int retries) {
		posts.recordFailure(publishing, publishing.failed(reason), reason);
		jobs.finish(claimed, next, AttemptOutcome.error(reason.kind().name(), "", retries), clock.instant());
	}

	private void retryLater(ClaimedJob claimed, Job next, AttemptOutcome outcome) {
		jobs.finish(claimed, next, outcome, clock.instant().plus(NEXT_TICK));
	}
}
