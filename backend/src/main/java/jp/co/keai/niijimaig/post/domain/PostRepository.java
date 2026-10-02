package jp.co.keai.niijimaig.post.domain;

import java.util.Optional;
import java.util.UUID;

/** 投稿の記録。状態は出来事の追記で表し、上書きしない */
public interface PostRepository {

	/** 承認された版がある投稿を、公開の判断に必要な形で取り出す（承認前・破棄済みなどは空） */
	Optional<Post> findForPublishing(UUID postId);

	/** 公開用に準備済みの画像（承認された版ごと）。未準備なら空の一覧 */
	PostMediaList preparedMedia(UUID revisionId);

	void recordPreparedMedia(UUID revisionId, PostMedia prepared);

	void record(Post post, PostEvent event);

	void recordFailure(Post post, PostEvent failedEvent, FailureReason reason);

	void recordPublished(Post post, PostEvent publishedEvent, PublishResult result);
}
