package jp.co.keai.niijimaig.post.application;

import java.time.Clock;
import java.time.Duration;
import java.util.List;
import java.util.Optional;

import org.springframework.stereotype.Service;

import jp.co.keai.niijimaig.connection.domain.InstagramConnection;
import jp.co.keai.niijimaig.connection.domain.InstagramConnectionRepository;
import jp.co.keai.niijimaig.job.application.AttemptOutcome;
import jp.co.keai.niijimaig.job.application.ClaimedJob;
import jp.co.keai.niijimaig.job.application.JobRepository;
import jp.co.keai.niijimaig.post.domain.FailureKind;
import jp.co.keai.niijimaig.post.domain.FailureReason;
import jp.co.keai.niijimaig.post.domain.ImageSpec;
import jp.co.keai.niijimaig.post.domain.Post;
import jp.co.keai.niijimaig.post.domain.PostEvent;
import jp.co.keai.niijimaig.post.domain.PostMediaList;
import jp.co.keai.niijimaig.post.domain.PostRepository;
import jp.co.keai.niijimaig.tenant.domain.Tenant;
import jp.co.keai.niijimaig.tenant.domain.TenantRepository;

/**
 * ユースケース「予定どおり公開する（中断した公開の確認を含む）」。
 * 判断は Post（nextStep・violationsForPublishing）と FailureKind に任せ、ここは取得・命令・記録の調整だけを行う。
 */
@Service
public class PostPublishing {

	static final Duration WAIT_FOR_MEDIA = Duration.ofMinutes(15);

	private final PostRepository posts;
	private final TenantRepository tenants;
	private final InstagramConnectionRepository connections;
	private final PublishingCollaborators collaborators;
	private final JobRepository jobs;
	private final Clock clock;

	public PostPublishing(PostRepository posts, TenantRepository tenants, InstagramConnectionRepository connections,
			PublishingCollaborators collaborators, JobRepository jobs, Clock clock) {
		this.posts = posts;
		this.tenants = tenants;
		this.connections = connections;
		this.collaborators = collaborators;
		this.jobs = jobs;
		this.clock = clock;
	}

	public void run(ClaimedJob claimed) {
		Optional<Post> found = posts.findForPublishing(claimed.requirePostId());
		if (found.isEmpty()) {
			finish(claimed, AttemptOutcome.success(0));
			return;
		}
		Post post = found.get();
		Tenant tenant = tenants.find(post.tenantId()).orElseThrow();
		post.nextStep(clock.instant(), tenant.publishGrace()).handle(new StepHandler(claimed, post, tenant));
	}

	private void finish(ClaimedJob claimed, AttemptOutcome outcome) {
		jobs.finish(claimed, claimed.job().succeeded(), outcome, clock.instant());
	}

	private final class StepHandler implements Post.PublishingStep.Handler {

		private final ClaimedJob claimed;
		private final Post post;
		private final Tenant tenant;
		private final InAttemptRetry retry;

		StepHandler(ClaimedJob claimed, Post post, Tenant tenant) {
			this.claimed = claimed;
			this.post = post;
			this.tenant = tenant;
			this.retry = collaborators.newRetry();
		}

		@Override
		public void skip(String reason) {
			finish(claimed, AttemptOutcome.success(0));
		}

		@Override
		public void expire(PostEvent event, FailureReason reason) {
			posts.recordFailure(post, event, reason);
			finish(claimed, AttemptOutcome.error(reason.kind().name(), "", 0));
		}

		@Override
		public void start(PostEvent event) {
			Optional<InstagramConnection> connection = connections.current(tenant.id());
			if (connection.isEmpty()) {
				failBeforeStart(FailureReason.of(FailureKind.TOKEN_INVALID));
				return;
			}
			PostMediaList prepared = posts.preparedMedia(post.approvedRevisionId());
			if (prepared.count() == 0) {
				waitForMedia();
				return;
			}
			List<String> violations = post.violationsForPublishing(prepared, new ImageSpec(), tenant.prLabel());
			if (!violations.isEmpty()) {
				failBeforeStart(new FailureReason(FailureKind.MEDIA_REJECTED, String.join(" / ", violations)));
				return;
			}
			posts.record(post, event);
			Post publishing = post.apply(event);
			apply(publishing, publication().publishNew(target(publishing, connection.get(), prepared)));
		}

		@Override
		public void recover() {
			Optional<InstagramConnection> connection = connections.current(tenant.id());
			if (connection.isEmpty()) {
				apply(post, PublicationResult.failed(FailureReason.of(FailureKind.TOKEN_INVALID)));
				return;
			}
			PostMediaList prepared = posts.preparedMedia(post.approvedRevisionId());
			apply(post, publication().recover(target(post, connection.get(), prepared)));
		}

		private void apply(Post publishing, PublicationResult result) {
			new PublicationRecorder(posts, jobs, clock).record(claimed, publishing, result, retry.retries());
		}

		private void failBeforeStart(FailureReason reason) {
			posts.recordFailure(post, post.failed(reason), reason);
			jobs.finish(claimed, claimed.job().failedFinally(), AttemptOutcome.error(reason.kind().name(), "", 0), clock.instant());
		}

		private void waitForMedia() {
			jobs.finish(claimed, claimed.job().failedOrRetry(),
					AttemptOutcome.error("MEDIA_NOT_PREPARED", "公開用画像の準備を待っています", 0),
					clock.instant().plus(WAIT_FOR_MEDIA));
		}

		private InstagramPublication publication() {
			return new InstagramPublication(collaborators.instagram(), collaborators.log(), retry);
		}

		private InstagramPublication.Target target(Post target, InstagramConnection connection, PostMediaList prepared) {
			List<String> urls = prepared.storagePaths().stream().map(collaborators.storage()::publicUrl).toList();
			return new InstagramPublication.Target(target, connection, target.publishCaption(tenant.prLabel()), urls,
					claimed.attemptId());
		}
	}
}
