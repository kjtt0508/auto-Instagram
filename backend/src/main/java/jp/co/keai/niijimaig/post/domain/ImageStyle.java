package jp.co.keai.niijimaig.post.domain;

/**
 * 画像の種類: 画像生成で作る画像の見た目の種類。種類ごとに開示と確認の扱いが変わる（REQ-005 BR-005-01 の表）。
 * 背景・イラストはどれも出さず、写真風はどれも出す（イメージ写真としてだけ使う）。TS の ImageStyle と揃える
 */
public enum ImageStyle {
	ILLUSTRATION(false),
	PHOTOREALISTIC(true);

	private final boolean realistic;

	ImageStyle(boolean realistic) {
		this.realistic = realistic;
	}

	/** 生成時に「イメージ写真としてだけ使えます」の注意書きを出すか（AC-005-09） */
	public boolean showsCaution() {
		return realistic;
	}

	/** 承認時に「写真風の生成画像を含みます」の確認を出すか（AC-005-08） */
	public boolean needsApprovalCheck() {
		return realistic;
	}

	/** 公開時にAI生成の表示（キャプション末尾・AI info）を付けるか（BR-005-05） */
	public boolean requiresAiDisclosure() {
		return realistic;
	}
}
