package jp.co.keai.niijimaig.post.domain;

import java.util.HashSet;
import java.util.List;

/**
 * 最後のスライドの画像一覧: 投稿の型の設定の1つの版が持つ、最後のスライドの画像の並び（REQ-007）。並びの中の位置が順（1枚目が左）。
 * 0〜ClosingContent.MAX_IMAGES 枚で、同じ保存先を2回入れない。Java は記録から戻して、並べる順の参照を返すだけ
 * （足す・選び直す・外すは画面の編集なので TS の ClosingImageList だけが持つ）。TS の ClosingImageList と揃える
 */
public final class ClosingImageList {

	private static final ClosingImageList EMPTY = new ClosingImageList(List.of());

	private final List<ClosingImage> images;

	private ClosingImageList(List<ClosingImage> images) {
		if (images == null || images.stream().anyMatch(i -> i == null)) {
			throw new IllegalArgumentException("最後のスライドの画像は必須");
		}
		if (images.size() > ClosingContent.MAX_IMAGES) {
			throw new IllegalArgumentException("最後のスライドの画像は" + ClosingContent.MAX_IMAGES + "枚までです");
		}
		if (new HashSet<>(images).size() != images.size()) {
			throw new IllegalArgumentException("同じ画像を最後のスライドに重ねられません");
		}
		this.images = List.copyOf(images);
	}

	/** 画像が0枚の一覧 */
	public static ClosingImageList empty() {
		return EMPTY;
	}

	/** 記録（並べる順）から戻す。DB の制約と同じ条件（枚数・重複）だけを確かめる */
	public static ClosingImageList restore(List<ClosingImage> images) {
		return new ClosingImageList(images);
	}

	/** 並べる順の画像の参照（保存先） */
	public List<String> refs() {
		return images.stream().map(ClosingImage::storagePath).toList();
	}

	public int count() {
		return images.size();
	}

	@Override
	public boolean equals(Object o) {
		return o instanceof ClosingImageList l && l.images.equals(images);
	}

	@Override
	public int hashCode() {
		return images.hashCode();
	}

	@Override
	public String toString() {
		return "ClosingImageList" + refs();
	}
}
