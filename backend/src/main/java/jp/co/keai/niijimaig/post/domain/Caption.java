package jp.co.keai.niijimaig.post.domain;

/** キャプション: 投稿の本文（ハッシュタグを含む）。2,200文字以下、ハッシュタグ30個以下 */
public final class Caption {

	static final int MAX_LENGTH = 2200;
	static final int MAX_HASHTAGS = 30;

	private final String text;

	public Caption(String text) {
		if (text == null) {
			throw new IllegalArgumentException("キャプションは必須");
		}
		int length = text.codePointCount(0, text.length());
		if (length > MAX_LENGTH) {
			throw new IllegalArgumentException("キャプションは" + MAX_LENGTH + "文字以内です（" + length + "文字）");
		}
		this.text = text;
		if (hashtagCount() > MAX_HASHTAGS) {
			throw new IllegalArgumentException("ハッシュタグは" + MAX_HASHTAGS + "個までです（" + hashtagCount() + "個）");
		}
	}

	public long hashtagCount() {
		return Hashtag.IN_TEXT.matcher(text).results().count();
	}

	/** 先頭と末尾に付記（PR表記・AI生成の表示）を付けた新しいキャプション（付けた結果も上限を守る。守れなければ例外） */
	Caption withNotices(String prefix, String suffix) {
		return new Caption(prefix + text + suffix);
	}

	/** 付記を付けても上限に収まるか */
	boolean fitsWithNotices(String prefix, String suffix) {
		return lengthWithNotices(prefix, suffix) <= MAX_LENGTH;
	}

	/** 付記を付けたときの文字数（コードポイントで数える） */
	int lengthWithNotices(String prefix, String suffix) {
		String joined = prefix + text + suffix;
		return joined.codePointCount(0, joined.length());
	}

	public String text() {
		return text;
	}

	@Override
	public boolean equals(Object o) {
		return o instanceof Caption c && c.text.equals(text);
	}

	@Override
	public int hashCode() {
		return text.hashCode();
	}
}
