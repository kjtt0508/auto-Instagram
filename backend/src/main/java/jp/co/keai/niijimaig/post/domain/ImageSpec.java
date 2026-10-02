package jp.co.keai.niijimaig.post.domain;

import java.util.ArrayList;
import java.util.List;

/**
 * 画像仕様: Instagram API で公開できる画像の条件（JPEG・8MB以下・アスペクト比4:5〜1.91:1・幅320〜1440px）。
 * JPEG であることは保存・変換の時点で保証し、ここでは寸法と容量を判断する。
 */
public final class ImageSpec {

	static final int MIN_WIDTH = 320;
	static final int MAX_WIDTH = 1440;
	static final long MAX_BYTES = 8L * 1024 * 1024;
	static final double MIN_ASPECT = 0.8;
	static final double MAX_ASPECT = 1.91;
	private static final double TOLERANCE = 0.005;

	/** 満たさない項目の説明。空なら仕様どおり */
	public List<String> violationsOf(PostMedia media) {
		List<String> violations = new ArrayList<>();
		if (!media.widthWithin(MIN_WIDTH, MAX_WIDTH)) {
			violations.add("画像の幅は" + MIN_WIDTH + "〜" + MAX_WIDTH + "pxです");
		}
		if (!media.bytesAtMost(MAX_BYTES)) {
			violations.add("画像は8MB以下です");
		}
		if (!media.aspectWithin(MIN_ASPECT - TOLERANCE, MAX_ASPECT + TOLERANCE)) {
			violations.add("画像の縦横比は4:5〜1.91:1です");
		}
		return List.copyOf(violations);
	}

	public boolean isSatisfiedBy(PostMedia media) {
		return violationsOf(media).isEmpty();
	}
}
