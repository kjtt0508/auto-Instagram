package jp.co.keai.niijimaig.post.domain;

import java.util.UUID;

/**
 * 過去の投稿の表紙: 最後のスライドに載せる、過去に公開した投稿1件（投稿IDと、その投稿の投稿画像の1枚目）。
 * 公開済みの投稿で、載せる投稿自身ではない（REQ-002 BR-002-15）。選ぶのは承認の出来事（RPC approve_post）。TS の PastPostCover と揃える
 */
public record PastPostCover(UUID postId, String coverStoragePath) {

	/** 最後のスライドに載せる最大件数 */
	static final int MAX_COUNT = 2;

	public PastPostCover {
		if (postId == null || coverStoragePath == null || coverStoragePath.isBlank()) {
			throw new IllegalArgumentException("投稿IDと表紙の保存先は必須");
		}
	}

	/** 載せる投稿（ownPostId）自身の表紙なら例外 */
	public static PastPostCover of(UUID postId, String coverStoragePath, UUID ownPostId) {
		if (postId.equals(ownPostId)) {
			throw new IllegalArgumentException("投稿自身の表紙は載せられません");
		}
		return new PastPostCover(postId, coverStoragePath);
	}
}
