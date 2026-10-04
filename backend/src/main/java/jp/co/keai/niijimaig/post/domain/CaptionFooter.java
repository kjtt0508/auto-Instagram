package jp.co.keai.niijimaig.post.domain;

/**
 * キャプションの定型: キャプションの本文の後ろに毎回付ける締めの文（区切り線・団体の名乗り・アカウントの紹介など）。
 * 団体の設定値（投稿の型の設定）で、AI は書き換えない。TS の CaptionFooter と揃える
 */
public final class CaptionFooter {

	private final String text;

	public CaptionFooter(String text) {
		if (text == null || text.isBlank()) {
			throw new IllegalArgumentException("キャプションの定型は空にできません");
		}
		this.text = text;
	}

	public String text() {
		return text;
	}
}
