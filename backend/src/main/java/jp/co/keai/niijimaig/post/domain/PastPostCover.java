package jp.co.keai.niijimaig.post.domain;

import java.util.Objects;
import java.util.UUID;

/**
 * 過去の投稿の表紙: 最後のスライドに載せる、過去に公開した投稿1件（投稿IDと、その投稿の投稿画像の1枚目）。
 * 公開済みの投稿で、載せる投稿自身ではない（REQ-002 BR-002-15）。選ぶのは承認の出来事（RPC approve_post）だけで、ここは値と不変条件だけを持つ。
 * 作り方は of（載せる投稿自身でないことを検査する）と restore（記録から戻す）。TS の PastPostCover と揃える
 */
public final class PastPostCover {

	/** 最後のスライドに載せる最大件数 */
	static final int MAX_COUNT = 2;

	private final UUID postId;
	private final String coverStoragePath;

	private PastPostCover(UUID postId, String coverStoragePath) {
		if (postId == null || coverStoragePath == null || coverStoragePath.isBlank()) {
			throw new IllegalArgumentException("投稿IDと表紙の保存先は必須");
		}
		this.postId = postId;
		this.coverStoragePath = coverStoragePath;
	}

	/** 載せる投稿（ownPostId）自身の表紙なら例外 */
	public static PastPostCover of(UUID postId, String coverStoragePath, UUID ownPostId) {
		if (postId != null && postId.equals(ownPostId)) {
			throw new IllegalArgumentException("投稿自身の表紙は載せられません");
		}
		return new PastPostCover(postId, coverStoragePath);
	}

	/** 記録から戻す（承認の出来事が選んだ結果なので、載せる投稿との関係は検査しない） */
	public static PastPostCover restore(UUID postId, String coverStoragePath) {
		return new PastPostCover(postId, coverStoragePath);
	}

	public UUID postId() {
		return postId;
	}

	public String coverStoragePath() {
		return coverStoragePath;
	}

	@Override
	public boolean equals(Object o) {
		return o instanceof PastPostCover c && c.postId.equals(postId) && c.coverStoragePath.equals(coverStoragePath);
	}

	@Override
	public int hashCode() {
		return Objects.hash(postId, coverStoragePath);
	}

	@Override
	public String toString() {
		return "PastPostCover[" + postId + ", " + coverStoragePath + "]";
	}
}
