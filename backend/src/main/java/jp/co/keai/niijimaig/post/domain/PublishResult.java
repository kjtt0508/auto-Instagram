package jp.co.keai.niijimaig.post.domain;

import java.time.Instant;

/** 公開結果: 公開に成功したときに Instagram から得た情報 */
public record PublishResult(String igMediaId, String permalink, Instant publishedAt) {

	public PublishResult {
		if (igMediaId == null || igMediaId.isBlank() || publishedAt == null) {
			throw new IllegalArgumentException("メディアIDと公開日時は必須");
		}
		if (permalink == null) {
			throw new IllegalArgumentException("パーマリンクは必須");
		}
	}
}
