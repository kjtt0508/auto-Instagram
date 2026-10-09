package jp.co.keai.niijimaig.post.application;

import java.time.Instant;

import org.springframework.stereotype.Component;

import jp.co.keai.niijimaig.post.domain.Post;
import jp.co.keai.niijimaig.post.domain.PostMediaList;
import jp.co.keai.niijimaig.post.domain.PostRepository;

/** 準備のしかた「複製」: アップロード画像を、非公開の保存先から公開用へ複製する。準備済みの画像は複製しない（冪等） */
@Component
class MediaCopying implements PreparationMethod {

	private final PostRepository posts;
	private final MediaStorage storage;

	MediaCopying(PostRepository posts, MediaStorage storage) {
		this.posts = posts;
		this.storage = storage;
	}

	@Override
	public void prepare(Post post, Instant deadline) {
		PostMediaList prepared = posts.preparedMedia(post.approvedRevisionId(), post.preparation());
		post.originalsNotYetIn(prepared).forEach(original -> posts.recordPreparedMedia(
				post.approvedRevisionId(),
				original.copiedTo(storage.copyToPublic(post.tenantId(), original.storagePath()))));
	}
}
