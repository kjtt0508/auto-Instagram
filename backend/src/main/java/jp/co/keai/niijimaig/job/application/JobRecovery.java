package jp.co.keai.niijimaig.job.application;

import java.time.Clock;

import org.springframework.stereotype.Service;

import jp.co.keai.niijimaig.job.domain.Job;
import jp.co.keai.niijimaig.post.domain.FailureKind;
import jp.co.keai.niijimaig.post.domain.FailureReason;
import jp.co.keai.niijimaig.post.domain.Post;
import jp.co.keai.niijimaig.post.domain.PostRepository;

/**
 * ユースケース「実行期限切れのジョブを回収する」。処理が落ちて実行中のまま残ったジョブを、
 * 試行回数が残っていれば待機に戻す（公開ジョブなら次の実行で中断した公開を確かめる）。
 * 尽きていれば失敗にし、公開処理中の投稿は人に確認を頼む失敗にする。
 */
@Service
public class JobRecovery {

	private final JobRepository jobs;
	private final PostRepository posts;
	private final Clock clock;

	public JobRecovery(JobRepository jobs, PostRepository posts, Clock clock) {
		this.jobs = jobs;
		this.posts = posts;
		this.clock = clock;
	}

	public void run() {
		jobs.expiredRunning().forEach(this::recover);
	}

	private void recover(ClaimedJob expired) {
		Job next = expired.job().recoverExpired();
		jobs.finish(expired, next, AttemptOutcome.error("EXPIRED", "実行期限切れ（処理が中断した）", 0), clock.instant());
		if (next.isFinallyFailed()) {
			expired.postId().flatMap(posts::findForPublishing).ifPresent(this::abandon);
		}
	}

	private void abandon(Post post) {
		FailureReason reason = FailureReason.of(FailureKind.UNKNOWN);
		post.abandonInterruptedPublishing(reason).ifPresent(event -> posts.recordFailure(post, event, reason));
	}
}
