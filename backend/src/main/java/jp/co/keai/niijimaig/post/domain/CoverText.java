package jp.co.keai.niijimaig.post.domain;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * 表紙の文言: 表紙の3段に描く文言。対象・キーワード（1〜10文字）・添え書き（0〜16文字）・締めの言葉（1〜8文字）と、帯のアクセント色。
 * 対象は投稿の型の設定の「表紙の対象の候補」のどれか（REQ-002 BR-002-12）。TS の CoverText と揃える（docs/model/fixtures/slide-text.json）
 */
public final class CoverText {

	static final int KEYWORD_MAX = 10;
	static final int ANNOTATION_MAX = 16;
	static final int CLOSING_WORDS_MAX = 8;

	/** 検査する前の文言（アクセント色は区分のコード。AI の出力は文字列のため） */
	public record Parts(String target, String keyword, String annotation, String closingWords, String accentCode) {
	}

	private final String target;
	private final String keyword;
	private final String annotation;
	private final String closingWords;
	private final AccentColor accent;

	private CoverText(String target, String keyword, String annotation, String closingWords, AccentColor accent) {
		if (target == null || keyword == null || annotation == null || closingWords == null || accent == null) {
			throw new IllegalArgumentException("表紙の文言の項目は必須");
		}
		this.target = target;
		this.keyword = keyword;
		this.annotation = annotation;
		this.closingWords = closingWords;
		this.accent = accent;
	}

	public String target() {
		return target;
	}

	public String keyword() {
		return keyword;
	}

	public String annotation() {
		return annotation;
	}

	public String closingWords() {
		return closingWords;
	}

	public AccentColor accent() {
		return accent;
	}

	@Override
	public boolean equals(Object o) {
		return o instanceof CoverText t && t.target.equals(target) && t.keyword.equals(keyword) && t.annotation.equals(annotation)
				&& t.closingWords.equals(closingWords) && t.accent == accent;
	}

	@Override
	public int hashCode() {
		return Objects.hash(target, keyword, annotation, closingWords, accent);
	}

	/** 満たさない条件（空なら受け付けられる） */
	public static List<String> violationsOf(Parts parts, PostStyleSettings settings) {
		List<String> violations = new ArrayList<>();
		if (!settings.acceptsCoverTarget(parts.target())) {
			violations.add("対象は" + String.join("", settings.coverTargets().stream().map(t -> "「" + t + "」").toList()) + "のどれかにしてください");
		}
		violations.addAll(SlideText.lengthViolations("キーワード", parts.keyword(), 1, KEYWORD_MAX));
		violations.addAll(SlideText.lengthViolations("添え書き", parts.annotation(), 0, ANNOTATION_MAX));
		violations.addAll(SlideText.lengthViolations("締めの言葉", parts.closingWords(), 1, CLOSING_WORDS_MAX));
		if (AccentColor.find(parts.accentCode()).isEmpty()) {
			String labels = String.join("・", Arrays.stream(AccentColor.values()).map(AccentColor::label).toList());
			violations.add("帯の色は" + labels + "のどれかにしてください");
		}
		return List.copyOf(violations);
	}

	/** 検査して作る。満たさなければ例外（人の入力を保存するとき） */
	public static CoverText of(Parts parts, PostStyleSettings settings) {
		List<String> violations = violationsOf(parts, settings);
		if (!violations.isEmpty()) {
			throw new IllegalArgumentException(String.join("\n", violations));
		}
		return restore(parts);
	}

	/** 記録から戻すときは検査しない（設定の候補が後で変わっても、過去の版を復元できる） */
	public static CoverText restore(Parts parts) {
		AccentColor accent = AccentColor.find(parts.accentCode())
				.orElseThrow(() -> new IllegalArgumentException("知らないアクセント色です: " + parts.accentCode()));
		return new CoverText(parts.target(), parts.keyword(), parts.annotation(), parts.closingWords(), accent);
	}

	/** 画像化でテンプレートに渡す値 */
	Map<String, Object> renderValues() {
		Map<String, Object> values = new LinkedHashMap<>();
		values.put("target", target);
		values.put("keyword", keyword);
		values.put("annotation", annotation);
		values.put("closingWords", closingWords);
		values.put("accentStart", accent.startColor());
		values.put("accentEnd", accent.endColor());
		return values;
	}
}
