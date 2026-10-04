package jp.co.keai.niijimaig.post.domain;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * スライド構成: テンプレートの投稿のスライドの並び。表紙1 → 中のスライド1〜8 → 最後のスライド1 の順（合計3〜10枚。REQ-002 BR-002-11）。
 * 画像化と公開に要る範囲だけを持つ（足し引き・下書き案の取り込みは画面側の TS の SlideList）。
 * TS の SlideList と揃える（docs/model/fixtures/slide-list.json）
 */
public final class SlideList {

	static final int BODY_MIN = 1;
	static final int BODY_MAX = 8;

	private final List<Slide> slides;

	private SlideList(List<Slide> slides) {
		this.slides = List.copyOf(slides);
	}

	/** 役割の並びが満たさない条件（空なら満たす） */
	public static List<String> violationsOf(List<SlideRole> roles) {
		List<SlideRole> middle = roles.size() >= 2 ? roles.subList(1, roles.size() - 1) : List.of();
		boolean ordered = roles.size() >= 2 && roles.get(0) == SlideRole.COVER && roles.get(roles.size() - 1) == SlideRole.CLOSING
				&& middle.stream().allMatch(r -> r == SlideRole.BODY);
		long bodyCount = roles.stream().filter(r -> r == SlideRole.BODY).count();
		List<String> violations = new ArrayList<>();
		if (!ordered) {
			violations.add("スライドは表紙1枚→中のスライド→最後のスライド1枚の順に並べてください");
		}
		if (bodyCount < BODY_MIN || bodyCount > BODY_MAX) {
			violations.add("中のスライドは" + BODY_MIN + "〜" + BODY_MAX + "枚にしてください（" + bodyCount + "枚）");
		}
		return List.copyOf(violations);
	}

	/** 並びと枚数を検査して作る。満たさなければ例外 */
	public static SlideList of(List<Slide> slides) {
		List<String> violations = violationsOf(slides.stream().map(Slide::role).toList());
		if (!violations.isEmpty()) {
			throw new IllegalArgumentException(String.join("\n", violations));
		}
		return new SlideList(slides);
	}

	/** 記録から戻すときは検査しない */
	public static SlideList restore(List<Slide> slides) {
		return new SlideList(slides);
	}

	public int count() {
		return slides.size();
	}

	/** 画像化に必要な画像の参照（保存先）の一覧 */
	public List<String> imageRefs() {
		return slides.stream().flatMap(s -> s.imageRefs().stream()).toList();
	}

	/** 写真風の生成画像を含むか（各スライドに委ねる） */
	boolean requiresAiDisclosure() {
		return slides.stream().anyMatch(Slide::requiresAiDisclosure);
	}

	/** 画像化のとき、承認で選んだ過去の投稿の表紙を最後のスライドに載せた新しい構成 */
	public SlideList withPastPosts(List<PastPostCover> covers) {
		List<Slide> replaced = new ArrayList<>(slides.subList(0, slides.size() - 1));
		replaced.add(new Slide(new ClosingContent(covers)));
		return of(replaced);
	}

	/** 画像化でテンプレートに渡すスライドごとの値（上から順） */
	public List<Map<String, Object>> renderValues() {
		return slides.stream().map(Slide::renderValues).toList();
	}
}
