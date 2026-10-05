package jp.co.keai.niijimaig.post.domain;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * スライドの文言: 中のスライドに描く見出し（1〜16文字）・説明文（1〜120文字）と、説明文の中で赤字にする強調する語（0〜3か所）。
 * 強調する語は説明文に含まれる部分文字列で、互いに重ならない（REQ-002 BR-002-13）。
 * 同じ語が説明文に複数あるときは、前の強調する語と重ならない最初の位置に当てはめる。
 * TS の SlideText と揃える（docs/model/fixtures/slide-text.json）
 */
public final class SlideText {

	static final int HEADING_MAX = 16;
	static final int DESCRIPTION_MAX = 120;
	static final int EMPHASES_MAX = 3;

	/** 説明文を分けた1区切り。emphasized なら赤字にする */
	public record Segment(String text, boolean emphasized) {
	}

	private record Range(int start, int end) {
		boolean overlaps(Range other) {
			return start < other.end && other.start < end;
		}
	}

	private record Placement(List<Range> ranges, List<String> empty, List<String> missing, List<String> overlapping) {
	}

	private final String heading;
	private final String description;
	private final List<String> emphases;

	private SlideText(String heading, String description, List<String> emphases) {
		if (heading == null || description == null || emphases == null) {
			throw new IllegalArgumentException("スライドの文言の項目は必須");
		}
		this.heading = heading;
		this.description = description;
		this.emphases = List.copyOf(emphases);
	}

	public String heading() {
		return heading;
	}

	public String description() {
		return description;
	}

	public List<String> emphases() {
		return emphases;
	}

	/** 記録から戻すときは検査しない（過去の版を復元できるように） */
	public static SlideText restore(String heading, String description, List<String> emphases) {
		return new SlideText(heading, description, emphases);
	}

	@Override
	public boolean equals(Object o) {
		return o instanceof SlideText t && t.heading.equals(heading) && t.description.equals(description) && t.emphases.equals(emphases);
	}

	@Override
	public int hashCode() {
		return java.util.Objects.hash(heading, description, emphases);
	}

	/** 満たさない条件（空なら受け付けられる）。AI の出力にも人の書き換えにも同じ検査をかける */
	public static List<String> violationsOf(String heading, String description, List<String> emphases) {
		Placement placement = place(description, emphases);
		List<String> violations = new ArrayList<>(lengthViolations("見出し", heading, 1, HEADING_MAX));
		violations.addAll(lengthViolations("説明文", description, 1, DESCRIPTION_MAX));
		if (emphases.size() > EMPHASES_MAX) {
			violations.add("強調する語は" + EMPHASES_MAX + "か所までです（" + emphases.size() + "か所）");
		}
		placement.empty().forEach(w -> violations.add("強調する語は空にできません"));
		placement.missing().forEach(w -> violations.add("強調する語「" + w + "」が説明文にありません"));
		placement.overlapping().forEach(w -> violations.add("強調する語「" + w + "」が他の強調する語と重なっています"));
		return List.copyOf(violations);
	}

	/** 検査して作る。満たさなければ例外（人の入力を保存するとき） */
	public static SlideText of(String heading, String description, List<String> emphases) {
		if (heading == null || description == null || emphases == null) {
			throw new IllegalArgumentException("スライドの文言の項目は必須");
		}
		List<String> violations = violationsOf(heading, description, emphases);
		if (!violations.isEmpty()) {
			throw new IllegalArgumentException(String.join("\n", violations));
		}
		return new SlideText(heading, description, emphases);
	}

	/** 文字数の検査（コードポイントで数える。絵文字は1文字）。表紙の文言と共通 */
	static List<String> lengthViolations(String label, String text, int min, int max) {
		int length = text.codePointCount(0, text.length());
		if (length >= min && length <= max) {
			return List.of();
		}
		String range = min > 0 ? min + "〜" + max + "文字にしてください" : max + "文字以内にしてください";
		return List.of(label + "は" + range + "（" + length + "文字）");
	}

	/** 説明文を、強調する部分とそれ以外に分けた並び（テンプレートが強調する部分を赤字に描く） */
	public List<Segment> segments() {
		List<Range> ranges = new ArrayList<>(place(description, emphases).ranges());
		ranges.sort(Comparator.comparingInt(Range::start));
		List<Segment> segments = new ArrayList<>();
		int cursor = 0;
		for (Range range : ranges) {
			if (range.start() > cursor) {
				segments.add(new Segment(description.substring(cursor, range.start()), false));
			}
			segments.add(new Segment(description.substring(range.start(), range.end()), true));
			cursor = range.end();
		}
		if (cursor < description.length()) {
			segments.add(new Segment(description.substring(cursor), false));
		}
		return List.copyOf(segments);
	}

	/** 強調する語を説明文の中の位置に当てはめる。当てはめられない語は、説明文に無いものと、重なるものに分けて返す */
	private static Placement place(String description, List<String> words) {
		Placement placement = new Placement(new ArrayList<>(), new ArrayList<>(), new ArrayList<>(), new ArrayList<>());
		for (String word : words) {
			if (word.isEmpty()) {
				placement.empty().add(word);
				continue;
			}
			List<Range> found = occurrences(description, word);
			found.stream().filter(r -> placement.ranges().stream().noneMatch(r::overlaps)).findFirst()
					.ifPresentOrElse(placement.ranges()::add,
							() -> (found.isEmpty() ? placement.missing() : placement.overlapping()).add(word));
		}
		return placement;
	}

	private static List<Range> occurrences(String description, String word) {
		List<Range> found = new ArrayList<>();
		for (int at = description.indexOf(word); at >= 0; at = description.indexOf(word, at + 1)) {
			found.add(new Range(at, at + word.length()));
		}
		return found;
	}
}
