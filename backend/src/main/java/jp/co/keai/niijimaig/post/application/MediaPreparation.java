package jp.co.keai.niijimaig.post.application;

import java.time.Clock;
import java.util.Optional;

import org.springframework.stereotype.Service;

import jp.co.keai.niijimaig.job.application.AttemptOutcome;
import jp.co.keai.niijimaig.job.application.ClaimedJob;
import jp.co.keai.niijimaig.job.application.JobRepository;
import jp.co.keai.niijimaig.post.domain.Post;
import jp.co.keai.niijimaig.post.domain.PostMediaList;
import jp.co.keai.niijimaig.post.domain.PostRepository;

/**
 * ユースケース「公開用画像を準備する」（REQ-001.md 6.2）。
 * アップロード画像は非公開の保存先から公開用へ複製する。準備済みの画像は複製しない（冪等）。
 * テンプレートの画像化はフェーズ2で追加する。
 */
@Service
public class MediaPreparation {

	private final PostRepository posts;
	private final MediaStorage storage;
	private final JobRepository jobs;
	private final Clock clock;

	public MediaPreparation(PostRepository posts, MediaStorage storage, JobRepository jobs, Clock clock) {
		this.posts = posts;
		this.storage = storage;
		this.jobs = jobs;
		this.clock = clock;
	}

	public void run(ClaimedJob claimed) {
		Optional<Post> found = posts.findForPublishing(claimed.requirePostId());
		found.ifPresent(this::prepare);
		jobs.finish(claimed, claimed.job().succeeded(), AttemptOutcome.success(0), clock.instant());
	}

	private void prepare(Post post) {
		PostMediaList prepared = posts.preparedMedia(post.approvedRevisionId());
		post.approvedMedia().notYetIn(prepared).forEach(original -> posts.recordPreparedMedia(
				post.approvedRevisionId(),
				original.copiedTo(storage.copyToPublic(post.tenantId(), original.storagePath()))));
	}
}
