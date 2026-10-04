package jp.co.keai.niijimaig.post.domain;

import java.util.Optional;

/**
 * 素材画像: 中のスライドのカードに載せる画像。生成画像（候補を採用したもの）か、人が差し替えた画像のどちらか一方。
 * 人が差し替えた画像は生成画像ではない（AI生成の表示は付かない。REQ-002 BR-002-20）。TS の MaterialImage と揃える
 */
public record MaterialImage(String storagePath, int width, int height, Optional<GeneratedImage> generated) {

	public MaterialImage {
		if (storagePath == null || storagePath.isBlank()) {
			throw new IllegalArgumentException("保存先は必須");
		}
		if (width <= 0 || height <= 0) {
			throw new IllegalArgumentException("幅・高さは正の数");
		}
		if (generated == null) {
			throw new IllegalArgumentException("生成画像の有無は必須（人が差し替えた画像は Optional.empty）");
		}
	}

	/** 公開時にAI生成の表示が要る画像か（写真風の生成画像のときだけ） */
	boolean requiresAiDisclosure() {
		return generated.map(GeneratedImage::requiresAiDisclosure).orElse(false);
	}
}
