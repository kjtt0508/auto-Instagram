package jp.co.keai.niijimaig.post.domain;

import java.util.UUID;

/** 生成画像: 採用されて投稿画像になった候補。どの画像生成の何番目か（1〜4）と、画像の種類を持つ */
public record GeneratedImage(UUID generationId, int candidatePosition, ImageStyle style) {

	static final int MAX_POSITION = 4;

	public GeneratedImage {
		if (generationId == null || style == null) {
			throw new IllegalArgumentException("画像生成IDと画像の種類は必須");
		}
		if (candidatePosition < 1 || candidatePosition > MAX_POSITION) {
			throw new IllegalArgumentException("候補の位置は1〜" + MAX_POSITION + ": " + candidatePosition);
		}
	}

	public boolean requiresAiDisclosure() {
		return style.requiresAiDisclosure();
	}
}
