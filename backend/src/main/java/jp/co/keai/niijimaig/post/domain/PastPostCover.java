package jp.co.keai.niijimaig.post.domain;

import java.util.Objects;
import java.util.UUID;

/**
 * 過去の投稿の表紙: REQ-007 より前の承認で、最後のスライドに載せるために選んだ過去に公開した投稿1件（投稿IDと、その投稿の投稿画像の1枚目）。
 * REQ-007 で承認のときに選ぶことはやめたので、新しくは作らない。REQ-007 より前の承認の記録を戻すだけ（restore）で、
 * 記録した承認の画像化（再実行を含む）はこの表紙をそのまま使う（BR-007-05）。TS の PastPostCover と揃える
 */
public final class PastPostCover {

	private final UUID postId;
	private final String coverStoragePath;

	private PastPostCover(UUID postId, String coverStoragePath) {
		if (postId == null || coverStoragePath == null || coverStoragePath.isBlank()) {
			throw new IllegalArgumentException("投稿IDと表紙の保存先は必須");
		}
		this.postId = postId;
		this.coverStoragePath = coverStoragePath;
	}

	/** REQ-007 より前の承認の記録から戻す（そのときの承認が選んだ結果なので、載せる投稿との関係は検査しない） */
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
