package jp.co.keai.niijimaig.post.domain;

import java.util.regex.Pattern;

/** ハッシュタグ: 「#」で始まり空白を含まない分類語 */
public final class Hashtag {

	static final Pattern IN_TEXT = Pattern.compile("[#＃][^\\s#＃]+");

	private final String text;

	public Hashtag(String text) {
		if (text == null || !IN_TEXT.matcher(text).matches()) {
			throw new IllegalArgumentException("ハッシュタグは「#」で始まり空白を含みません: " + text);
		}
		this.text = text;
	}

	@Override
	public boolean equals(Object o) {
		return o instanceof Hashtag h && h.text.equals(text);
	}

	@Override
	public int hashCode() {
		return text.hashCode();
	}

	@Override
	public String toString() {
		return text;
	}
}
