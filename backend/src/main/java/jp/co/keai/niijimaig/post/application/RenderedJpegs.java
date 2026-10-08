package jp.co.keai.niijimaig.post.application;

import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import javax.imageio.ImageIO;

import jp.co.keai.niijimaig.post.domain.ImageSpec;
import jp.co.keai.niijimaig.post.domain.PostMedia;

/** 画像化した JPEG の検査: テンプレートの約束（1080×1350）と、公開できる画像の仕様（ImageSpec）を、実際の JPEG に対して確かめる */
final class RenderedJpegs {

	static final int WIDTH = 1080;
	static final int HEIGHT = 1350;

	private RenderedJpegs() {
	}

	/** JPEG を読み取り、検査して投稿画像にする。満たさなければ画像化の失敗 */
	static PostMedia checked(int position, String storagePath, byte[] jpeg) {
		BufferedImage image = decode(jpeg);
		PostMedia media = new PostMedia(position, storagePath, image.getWidth(), image.getHeight(), jpeg.length);
		List<String> violations = new ArrayList<>(new ImageSpec().violationsOf(media));
		if (image.getWidth() != WIDTH || image.getHeight() != HEIGHT) {
			violations.add("画像化した画像の大きさが " + WIDTH + "×" + HEIGHT + " ではありません");
		}
		if (!violations.isEmpty()) {
			throw new RenderFailedException(String.join(" / ", violations));
		}
		return media;
	}

	private static BufferedImage decode(byte[] jpeg) {
		try {
			return Optional.ofNullable(ImageIO.read(new ByteArrayInputStream(jpeg)))
					.orElseThrow(() -> new RenderFailedException("画像化した画像を読み取れません"));
		} catch (IOException e) {
			throw new RenderFailedException("画像化した画像を読み取れません", e);
		}
	}
}
