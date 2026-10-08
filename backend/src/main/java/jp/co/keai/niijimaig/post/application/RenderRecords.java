package jp.co.keai.niijimaig.post.application;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import jp.co.keai.niijimaig.post.domain.PastPostCover;
import jp.co.keai.niijimaig.post.domain.PostMedia;

/**
 * 画像化の記録（承認の出来事ごと）。再試行では先に既存の行を読み、あればそれを使う（一意制約に当たらないように）。実装は infrastructure
 */
public interface RenderRecords {

	/** 投稿の最新の承認の出来事 */
	long latestApprovalEvent(UUID postId);

	/** 承認の出来事で選んだ過去の投稿の表紙（0〜2件。順番どおり） */
	List<PastPostCover> pastPosts(long approvalEventId);

	/** 画像化した JPEG（記録済みなら） */
	Optional<PostMedia> rendered(long approvalEventId, int position);

	void recordRender(long approvalEventId, PostMedia rendered);

	/** TEMPLATE の版の公開用 JPEG（記録済みなら） */
	Optional<PostMedia> publishMedia(UUID revisionId, long approvalEventId, int position);

	void recordPublishMedia(UUID revisionId, long approvalEventId, PostMedia published);
}
