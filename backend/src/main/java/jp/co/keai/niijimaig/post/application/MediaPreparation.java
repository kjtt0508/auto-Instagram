package jp.co.keai.niijimaig.post.application;

import java.time.Clock;
import java.time.Duration;
import java.util.Map;
import java.util.Optional;

import org.springframework.stereotype.Service;

import jp.co.keai.niijimaig.job.application.AttemptOutcome;
import jp.co.keai.niijimaig.job.application.ClaimedJob;
import jp.co.keai.niijimaig.job.application.JobRepository;
import jp.co.keai.niijimaig.job.domain.Job;
import jp.co.keai.niijimaig.post.domain.FailureKind;
import jp.co.keai.niijimaig.post.domain.FailureReason;
import jp.co.keai.niijimaig.post.domain.Post;
import jp.co.keai.niijimaig.post.domain.PostRepository;
import jp.co.keai.niijimaig.post.domain.RevisionContent.Preparation;

/**
 * ユースケース「公開用画像を準備する」（REQ-001.md 6.2、REQ-002 設計 6章）。
 * 準備のしかた（複製か画像化か）は投稿の版が決める（preparation()）。ここは取得・実行・失敗の記録の調整だけを行う。
 * 画像化の失敗は、その場で投稿を失敗（画像化の失敗）にする。ブラウザを起動できないときは、ジョブを次の定期処理で再試行する（最大3回）。
 */
@Service
public class MediaPreparation {

	/** 再試行は次の定期処理（15分ごと）まで待つ */
	static final Duration RETRY_AFTER = Duration.ofMinutes(10);

	private final PostRepository posts;
	private final Map<Preparation, PreparationMethod> methods;
	private final JobRepository jobs;
	private final Clock clock;

	MediaPreparation(PostRepository posts, MediaCopying copying, TemplateRendering rendering, JobRepository jobs, Clock clock) {
		this.posts = posts;
		this.methods = Map.of(Preparation.COPY, copying, Preparation.RENDER, rendering);
		this.jobs = jobs;
		this.clock = clock;
	}

	public void run(ClaimedJob claimed) {
		Optional<Post> found = posts.findForPublishing(claimed.requirePostId());
		if (found.isEmpty()) {
			succeed(claimed);
			return;
		}
		Post post = found.get();
		try {
			methods.get(post.preparation()).prepare(post);
			succeed(claimed);
		} catch (RenderFailedException e) {
			failNow(claimed, post, e.getMessage());
		} catch (RenderBrowserUnavailableException e) {
			retryLater(claimed, post);
		}
	}

	private void succeed(ClaimedJob claimed) {
		jobs.finish(claimed, claimed.job().succeeded(), AttemptOutcome.success(0), clock.instant());
	}

	private void failNow(ClaimedJob claimed, Post post, String detail) {
		FailureReason reason = new FailureReason(FailureKind.RENDER_FAILED, FailureKind.RENDER_FAILED.guidance() + "（" + detail + "）");
		post.failedPreparing(reason).ifPresent(event -> posts.recordFailure(post, event, reason));
		jobs.finish(claimed, claimed.job().failedFinally(), AttemptOutcome.error(FailureKind.RENDER_FAILED.name(), detail, 0),
				clock.instant());
	}

	private void retryLater(ClaimedJob claimed, Post post) {
		Job next = claimed.job().failedOrRetry();
		if (next.isFinallyFailed()) {
			failNow(claimed, post, "画像化のブラウザを起動できませんでした");
			return;
		}
		jobs.finish(claimed, next, AttemptOutcome.error("BROWSER_UNAVAILABLE", "画像化のブラウザを起動できません", 0),
				clock.instant().plus(RETRY_AFTER));
	}
}
