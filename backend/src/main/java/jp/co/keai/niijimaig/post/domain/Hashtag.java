package jp.co.keai.niijimaig.post.domain;

import java.util.regex.Pattern;

/** ハッシュタグ: 「#」で始まり空白を含まない分類語 */
public final class Hashtag {

	/**
	 * 空白は Unicode の空白（全角空白 U+3000・NBSP U+00A0 を含む）。TS と同じ範囲にそろえるため、
	 * Java の \s（White_Space）に入る U+0085（NEL）を明示し、入らない U+FEFF（BOM）も明示して足す
	 */
	static final Pattern IN_TEXT = Pattern.compile("[#＃][^\\s\\u0085\\uFEFF#＃]+", Pattern.UNICODE_CHARACTER_CLASS);

	/** ハッシュタグの形か（「#」始まりで空白を含まない） */
	static boolean isHashtag(String text) {
		return text != null && IN_TEXT.matcher(text).matches();
	}

	private final String text;

	public Hashtag(String text) {
		if (!isHashtag(text)) {
			throw new IllegalArgumentException("ハッシュタグは「#」で始まり空白を含みません: " + text);
		}
		this.text = text;
	}

	/** 全角「＃」と半角「#」を同じものとして比べる */
	boolean sameAs(Hashtag other) {
		return normalized().equals(other.normalized());
	}

	private String normalized() {
		return text.replaceFirst("^＃", "#");
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
