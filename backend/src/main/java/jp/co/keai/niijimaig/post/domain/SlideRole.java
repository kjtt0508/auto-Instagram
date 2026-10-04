package jp.co.keai.niijimaig.post.domain;

/**
 * スライド役割: カルーセル内でのスライドの役割（表紙 / 中のスライド / 最後のスライド）。役割ごとに使うテンプレートと中身の型が決まる。
 * 並びは 表紙 → 中のスライド → 最後のスライド。TS の SlideRole と揃える
 */
public enum SlideRole {
	COVER("cover"),
	BODY("body"),
	CLOSING("closing");

	private final String templateName;

	SlideRole(String templateName) {
		this.templateName = templateName;
	}

	/** 使うテンプレートの名前（テンプレートの版の中の、役割ごとの描き方） */
	public String templateName() {
		return templateName;
	}
}
