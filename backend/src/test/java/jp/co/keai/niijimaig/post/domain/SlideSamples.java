package jp.co.keai.niijimaig.post.domain;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import tools.jackson.databind.JsonNode;

/** テストで使うスライド・投稿の型の設定の見本（キャプションの定型は caption.json の架空の文面） */
final class SlideSamples {

	private SlideSamples() {
	}

	/** fixtures の項目の値: 文字列か、{repeat, count}（repeat を count 回つなぐ） */
	static String valueOf(JsonNode node) {
		return node.isString() ? node.asString() : node.get("repeat").asString().repeat(node.get("count").asInt());
	}

	static PostStyleSettings settings() {
		JsonNode template = SharedFixtureCasesTest.fixture("caption.json").get("templateSettings");
		List<String> tags = new ArrayList<>();
		template.get("fixedHashtags").forEach(n -> tags.add(n.asString()));
		return new PostStyleSettings(UUID.randomUUID(), 1, "テスト帯", List.of("同志社大学", "同志社大生"), "ありがとうございます",
				"@test_account", new CaptionFooter(template.get("captionFooter").asString()), new FixedHashtags(tags), Optional.empty());
	}

	static CoverText coverText() {
		return CoverText.restore(new CoverText.Parts("同志社大学", "期末試験", "", "まとめたよ", "PURPLE"));
	}

	static BodyContent body(Optional<MaterialImage> material) {
		return new BodyContent(new SlideText("学割が使える", "学生証を見せるだけで割引になります。", List.of("学生証")), material);
	}

	static MaterialImage material(ImageStyle style) {
		Optional<GeneratedImage> generated = Optional.ofNullable(style).map(s -> new GeneratedImage(UUID.randomUUID(), 1, s));
		return new MaterialImage("t/materials/1.jpg", 800, 600, generated);
	}

	/** 表紙1 → 中のスライド bodies.size() 枚 → 最後のスライド1 */
	static SlideList slides(List<BodyContent> bodies) {
		List<Slide> slides = new ArrayList<>();
		slides.add(new Slide(new CoverContent(coverText(),
				Optional.of(new CoverContent.Background(UUID.randomUUID(), "t/backgrounds/1.jpg")))));
		bodies.forEach(b -> slides.add(new Slide(b)));
		slides.add(new Slide(ClosingContent.empty()));
		return SlideList.of(slides);
	}
}
