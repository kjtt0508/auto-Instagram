package jp.co.keai.niijimaig.post.application;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.EnumMap;
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
 * 画像化の内容による失敗は、その場で投稿を失敗（画像化の失敗）にする。一時的な失敗（ブラウザを起動できない・Storage や記録の失敗）は、
 * ジョブを次の定期処理で再試行する（最大3回。3回目も失敗したら画像化の失敗）。複製の準備の失敗の扱いは従来どおり。
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
		EnumMap<Preparation, PreparationMethod> byPreparation = new EnumMap<>(Preparation.class);
		byPreparation.put(Preparation.COPY, copying);
		byPreparation.put(Preparation.RENDER, rendering);
		for (Preparation preparation : Preparation.values()) {
			if (!byPreparation.containsKey(preparation)) {
				throw new IllegalStateException("準備のしかたが足りません: " + preparation);
			}
		}
		this.methods = byPreparation;
		this.jobs = jobs;
		this.clock = clock;
	}

	/** deadline を過ぎたら新しい作業を始めず、一時的な失敗として返す（写真の投稿の公開の時間を残す） */
	public void run(ClaimedJob claimed, Instant deadline) {
		Optional<Post> found = posts.findForPublishing(claimed.requirePostId());
		if (found.isEmpty()) {
			succeed(claimed);
			return;
		}
		Post post = found.get();
		try {
			methods.get(post.preparation()).prepare(post, deadline);
			succeed(claimed);
		} catch (RenderFailedException e) {
			failNow(claimed, post, e.getMessage());
		} catch (RenderTemporaryFailureException e) {
			retryLater(claimed, post, e);
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

	/**
	 * 一時的な失敗: ジョブを次の定期処理で再試行する。3回目も失敗したら画像化の失敗にする。
	 * ただし持ち時間切れで、この試行で1枚でも進んでいれば回数に数えない（1回の tick で1枚ずつしか描けなくても、全部描き終わる前に失敗にしない）。
	 * 1枚も進まなかった持ち時間切れは数える（進まない状態が続いたら失敗にする）
	 */
	private void retryLater(ClaimedJob claimed, Post post, RenderTemporaryFailureException e) {
		Job next = e.deferrable() ? claimed.job().deferred() : claimed.job().failedOrRetry();
		if (next.isFinallyFailed()) {
			failNow(claimed, post, "画像化の準備を完了できませんでした（" + e.code() + "）");
			return;
		}
		jobs.finish(claimed, next, AttemptOutcome.error(e.code(), e.getMessage(), 0), clock.instant().plus(RETRY_AFTER));
	}
}
