package jp.co.keai.niijimaig.post.domain;

/**
 * 画像化に必要な画像: 画像化のときに Storage から読む画像1つ。画像の参照（保存先）と、見つからないときの失敗理由の詳細、
 * その失敗が「今すぐ再実行」で直るか（REQ-007）。画像を持つ側（表紙の中身・中のスライドの中身・最後のスライドの中身・投稿の型の設定のロゴ）が作り、
 * 画像化は渡されたものから失敗を作るだけ（参照の形を見て分岐しない）。Java（画像化）だけが持つ
 */
public record RenderImageNeed(String ref, String missingDetail, boolean fixableByRerun) {

	/** 見つからないときの既定の詳細（背景写真・素材画像・ロゴ・過去の投稿の表紙） */
	public static final String DEFAULT_DETAIL = "画像化に必要な画像が見つかりません";

	public RenderImageNeed {
		if (ref == null || ref.isBlank() || missingDetail == null || missingDetail.isBlank()) {
			throw new IllegalArgumentException("画像の参照と見つからないときの詳細は必須");
		}
	}

	/** 既定の詳細で、「今すぐ再実行」で直る扱い（今までどおり） */
	public static RenderImageNeed of(String ref) {
		return new RenderImageNeed(ref, DEFAULT_DETAIL, true);
	}

	/** 「今すぐ再実行」では直らない（失敗理由に再実行の案内を付けない）。画像を持つ側が示す手順を詳細に書く */
	public static RenderImageNeed notFixableByRerun(String ref, String missingDetail) {
		return new RenderImageNeed(ref, missingDetail, false);
	}
}
