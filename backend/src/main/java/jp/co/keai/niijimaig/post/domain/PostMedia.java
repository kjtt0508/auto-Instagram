package jp.co.keai.niijimaig.post.domain;

import java.util.Optional;

/** 投稿画像: 投稿に含まれる1枚の画像（順番・保存先・幅・高さ・容量）。生成画像なら、その由来（GeneratedImage）を持つ */
public final class PostMedia {

	private final int position;
	private final String storagePath;
	private final int width;
	private final int height;
	private final long bytes;
	private final GeneratedImage generated;

	public PostMedia(int position, String storagePath, int width, int height, long bytes) {
		this(position, storagePath, width, height, bytes, Optional.empty());
	}

	public PostMedia(int position, String storagePath, int width, int height, long bytes, Optional<GeneratedImage> generated) {
		if (position < 1) {
			throw new IllegalArgumentException("順番は1以上: " + position);
		}
		if (storagePath == null || storagePath.isBlank()) {
			throw new IllegalArgumentException("保存先は必須");
		}
		if (width <= 0 || height <= 0 || bytes <= 0) {
			throw new IllegalArgumentException("幅・高さ・容量は正の数");
		}
		this.position = position;
		this.storagePath = storagePath;
		this.width = width;
		this.height = height;
		this.bytes = bytes;
		this.generated = generated.orElse(null);
	}

	/** 同じ画像を別の保存先に複製したもの */
	public PostMedia copiedTo(String newStoragePath) {
		return new PostMedia(position, newStoragePath, width, height, bytes, Optional.ofNullable(generated));
	}

	/** 公開時にAI生成の表示が要る画像か（写真風の生成画像） */
	boolean requiresAiDisclosure() {
		return generated != null && generated.requiresAiDisclosure();
	}

	/** 承認時の確認が要る画像か（写真風の生成画像） */
	boolean needsApprovalCheck() {
		return generated != null && generated.needsApprovalCheck();
	}

	public int width() {
		return width;
	}

	public int height() {
		return height;
	}

	public long bytes() {
		return bytes;
	}

	public double aspectRatio() {
		return (double) width / height;
	}

	public int position() {
		return position;
	}

	public String storagePath() {
		return storagePath;
	}

	boolean widthWithin(int min, int max) {
		return width >= min && width <= max;
	}

	boolean bytesAtMost(long max) {
		return bytes <= max;
	}

	boolean aspectWithin(double min, double max) {
		double aspect = aspectRatio();
		return aspect >= min && aspect <= max;
	}

	boolean sameAspectAs(PostMedia other) {
		return Math.abs(aspectRatio() - other.aspectRatio()) < 0.01;
	}
}
