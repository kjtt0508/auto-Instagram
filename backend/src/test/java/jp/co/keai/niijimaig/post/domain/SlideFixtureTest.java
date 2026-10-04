package jp.co.keai.niijimaig.post.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Stream;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

import tools.jackson.databind.JsonNode;

/** 表紙の文言・スライドの文言・スライド構成を、画面（TS）と同じ共通テストケースで確かめる（ADR-0005。文言も完全に同じ並びで比べる） */
class SlideFixtureTest {

	static Stream<JsonNode> coverCases() { return SharedFixtureCasesTest.cases("slide-text.json", "cover"); }
	static Stream<JsonNode> slideCases() { return SharedFixtureCasesTest.cases("slide-text.json", "slide"); }
	static Stream<JsonNode> slideListCases() { return SharedFixtureCasesTest.cases("slide-list.json", "cases"); }

	private static String field(JsonNode base, JsonNode overrides, String name) {
		return SlideSamples.valueOf(overrides.has(name) ? overrides.get(name) : base.get(name));
	}

	private static List<String> strings(JsonNode array) {
		List<String> list = new ArrayList<>();
		array.forEach(n -> list.add(n.asString()));
		return list;
	}

	@ParameterizedTest(name = "{0}")
	@MethodSource("coverCases")
	@DisplayName("AC-002-11 AC-002-22 表紙の文言（AI の出力にも人の書き換えにも同じ検査）")
	void coverText(JsonNode c) {
		JsonNode base = SharedFixtureCasesTest.fixture("slide-text.json").get("coverBase");
		JsonNode with = c.get("with");
		CoverText.Parts parts = new CoverText.Parts(field(base, with, "target"), field(base, with, "keyword"),
				field(base, with, "annotation"), field(base, with, "closingWords"), field(base, with, "accent"));
		List<String> expected = strings(c.get("violations"));

		assertThat(CoverText.violationsOf(parts, SlideSamples.settings())).isEqualTo(expected);
		if (expected.isEmpty()) {
			assertThat(CoverText.of(parts, SlideSamples.settings()).keyword()).isEqualTo(parts.keyword());
			return;
		}
		assertThatThrownBy(() -> CoverText.of(parts, SlideSamples.settings())).isInstanceOf(IllegalArgumentException.class)
				.hasMessageContaining(expected.get(0));
	}

	@ParameterizedTest(name = "{0}")
	@MethodSource("slideCases")
	@DisplayName("AC-002-12 AC-002-22 スライドの文言（AI の出力にも人の書き換えにも同じ検査）")
	void slideText(JsonNode c) {
		JsonNode base = SharedFixtureCasesTest.fixture("slide-text.json").get("slideBase");
		JsonNode with = c.get("with");
		String heading = field(base, with, "heading");
		String description = field(base, with, "description");
		List<String> emphases = strings(with.has("emphases") ? with.get("emphases") : base.get("emphases"));
		List<String> expected = strings(c.get("violations"));

		assertThat(SlideText.violationsOf(heading, description, emphases)).isEqualTo(expected);
		if (!expected.isEmpty()) {
			assertThatThrownBy(() -> SlideText.of(heading, description, emphases)).isInstanceOf(IllegalArgumentException.class);
			return;
		}
		if (c.has("segments")) {
			List<SlideText.Segment> segments = new ArrayList<>();
			c.get("segments").forEach(s -> segments.add(new SlideText.Segment(s.get("text").asString(), s.get("emphasized").asBoolean())));
			assertThat(SlideText.of(heading, description, emphases).segments()).isEqualTo(segments);
		}
	}

	@ParameterizedTest(name = "{0}")
	@MethodSource("slideListCases")
	@DisplayName("BR-002-11 スライド構成の並びと枚数")
	void slideListOrderAndCount(JsonNode c) {
		List<SlideRole> roles = c.get("layout").asString().chars().mapToObj(letter -> switch (letter) {
			case 'C' -> SlideRole.COVER;
			case 'B' -> SlideRole.BODY;
			default -> SlideRole.CLOSING;
		}).toList();

		assertThat(SlideList.violationsOf(roles)).isEqualTo(strings(c.get("violations")));
	}

	@Test
	@DisplayName("AC-002-15 BR-002-15 過去の投稿の表紙は2件まで。投稿自身の表紙は載せられない")
	void pastPostCovers() {
		var own = UUID.randomUUID();
		assertThatThrownBy(() -> PastPostCover.of(own, "t/a.jpg", own)).hasMessageContaining("投稿自身");
		List<PastPostCover> three = List.of(new PastPostCover(UUID.randomUUID(), "t/a.jpg"),
				new PastPostCover(UUID.randomUUID(), "t/b.jpg"), new PastPostCover(UUID.randomUUID(), "t/c.jpg"));
		assertThatThrownBy(() -> new ClosingContent(three)).hasMessageContaining("2件まで");
	}

	@Test
	@DisplayName("AC-002-02 画像化に渡す値と画像の参照: 背景写真・素材画像・承認で選んだ過去の投稿の表紙の保存先が上から順に並ぶ")
	void renderValuesAndImageRefs() {
		SlideList slides = SlideSamples.slides(List.of(SlideSamples.body(Optional.of(SlideSamples.material(ImageStyle.ILLUSTRATION)))));
		assertThat(slides.imageRefs()).containsExactly("t/backgrounds/1.jpg", "t/materials/1.jpg");

		SlideList withPast = slides.withPastPosts(List.of(new PastPostCover(UUID.randomUUID(), "t/posts/p2/1.jpg")));
		assertThat(withPast.imageRefs()).containsExactly("t/backgrounds/1.jpg", "t/materials/1.jpg", "t/posts/p2/1.jpg");
		assertThat(withPast.renderValues()).hasSize(3);
		assertThat(withPast.renderValues().get(0)).containsEntry("template", "cover").containsEntry("keyword", "期末試験")
				.containsEntry("accentStart", "#8C52FE").containsEntry("background", "t/backgrounds/1.jpg");
		assertThat(withPast.renderValues().get(1)).containsEntry("template", "body").containsEntry("heading", "学割が使える");
		assertThat(withPast.renderValues().get(2)).containsEntry("template", "closing");
	}

	@Test
	@DisplayName("AC-002-14 AC-002-19 写真風の生成画像の素材画像だけがAI生成の表示を要る。人が差し替えた画像は生成画像ではない")
	void aiDisclosureOfMaterials() {
		assertThat(SlideSamples.slides(List.of(SlideSamples.body(Optional.of(SlideSamples.material(ImageStyle.PHOTOREALISTIC)))))
				.requiresAiDisclosure()).isTrue();
		assertThat(SlideSamples.slides(List.of(SlideSamples.body(Optional.of(SlideSamples.material(ImageStyle.ILLUSTRATION)))))
				.requiresAiDisclosure()).isFalse();
		assertThat(SlideSamples.slides(List.of(SlideSamples.body(Optional.of(SlideSamples.material(null)))))
				.requiresAiDisclosure()).isFalse();
		assertThat(SlideSamples.slides(List.of(SlideSamples.body(Optional.empty()))).requiresAiDisclosure()).isFalse();
	}

	@Test
	@DisplayName("BR-002-12 アクセント色は紫・赤・青緑の3つだけで、赤と青緑はグラデーション")
	void accentColors() {
		assertThat(AccentColor.values()).extracting(AccentColor::label).containsExactly("紫", "赤", "青緑");
		assertThat(AccentColor.RED.startColor()).isEqualTo("#FD3432");
		assertThat(AccentColor.RED.endColor()).isEqualTo("#FE914C");
		assertThat(AccentColor.TEAL.startColor()).isEqualTo("#19BBAA");
		assertThat(AccentColor.TEAL.endColor()).isEqualTo("#066A85");
		assertThat(AccentColor.PURPLE.startColor()).isEqualTo(AccentColor.PURPLE.endColor());
		assertThat(AccentColor.find("GREEN")).isEmpty();
	}
}
