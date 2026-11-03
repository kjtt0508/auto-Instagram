package jp.co.keai.niijimaig.post.domain;

/**
 * 最後のスライドの画像: 最後のスライドの真ん中に並べる、管理者が投稿の型の設定でアップロードした画像1枚（REQ-007）。
 * 保存先だけを持つ（並びの順は最後のスライドの画像一覧の中の位置）。
 * 画面で 4:5 の中央を切り抜き、800×1000px まで縮小した JPEG にしてから作る。サーバーは画素数を確かめない。
 * Java は記録から戻すだけ。保存先の形（{団体}/style/{名前}.jpg）は保存の関数（DB）が検査し、画像化は OwnedStoragePath で団体の置き場所を確かめる。
 * TS の ClosingImage と揃える
 */
public final class ClosingImage {

	private final String storagePath;

	private ClosingImage(String storagePath) {
		if (storagePath == null || storagePath.isBlank()) {
			throw new IllegalArgumentException("最後のスライドの画像の保存先は必須");
		}
		this.storagePath = storagePath;
	}

	/** 記録から戻す（保存先の形は検査しない） */
	public static ClosingImage restore(String storagePath) {
		return new ClosingImage(storagePath);
	}

	public String storagePath() {
		return storagePath;
	}

	@Override
	public boolean equals(Object o) {
		return o instanceof ClosingImage c && c.storagePath.equals(storagePath);
	}

	@Override
	public int hashCode() {
		return storagePath.hashCode();
	}

	@Override
	public String toString() {
		return "ClosingImage[" + storagePath + "]";
	}
}
