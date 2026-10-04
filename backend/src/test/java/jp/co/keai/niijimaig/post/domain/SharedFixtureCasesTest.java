package jp.co.keai.niijimaig.post.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.IntStream;
import java.util.stream.Stream;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * 画面（TS）と同じ共通テストケース（docs/model/fixtures/*.json）を Java のドメインでも確かめる（ADR-0005）。
 * 文言（violation）は画面だけが比べ、ここでは可否だけを比べる。
 */
class SharedFixtureCasesTest {

	static final Instant NOW = Instant.parse("2026-10-02T01:00:00Z");

	static JsonNode fixture(String name) {
		return JsonMapper.builder().build().readTree(Path.of("../docs/model/fixtures/" + name).toFile());
	}

	static Stream<JsonNode> cases(String name, String field) {
		List<JsonNode> list = new ArrayList<>();
		fixture(name).get(field).forEach(list::add);
		return list.stream();
	}

	static Stream<JsonNode> captionCases() { return cases("caption.json", "cases"); }
	static Stream<JsonNode> imageCases() { return cases("image-spec.json", "images"); }
	static Stream<JsonNode> mediaCountCases() { return cases("image-spec.json", "mediaCounts"); }
	static Stream<JsonNode> scheduleCases() { return cases("scheduled-at.json", "decide"); }
	static Stream<JsonNode> styleCases() { return cases("image-style.json", "styles"); }

	@ParameterizedTest(name = "{0}")
	@MethodSource("captionCases")
	void キャプションとPR表記とAI生成の表示_AC_001_08_09_AC_005_04_10(JsonNode c) {
		StringBuilder text = new StringBuilder();
		c.get("segments").forEach(s -> text.append(s.get("repeat").asString().repeat(s.get("count").asInt())));
		if (!c.get("valid").asBoolean()) {
			assertThatThrownBy(() -> new Caption(text.toString())).isInstanceOf(IllegalArgumentException.class);
			return;
		}
		PrCategory category = PrCategory.valueOf(c.get("prCategory").asString());
		ImageStyle style = c.path("aiDisclosure").asBoolean(false) ? ImageStyle.PHOTOREALISTIC : null;
		Post post = CaptionTest.post(text.toString(), category, style);
		String label = fixture("caption.json").get("prLabel").asString();
		if (!c.get("publishValid").asBoolean()) {
			assertThatThrownBy(() -> post.publishCaption(label)).isInstanceOf(IllegalArgumentException.class);
			return;
		}
		Caption published = post.publishCaption(label);
		JsonNode expected = c.path("publishText");
		if (expected.isMissingNode()) {
			return;
		}
		assertThat(published.text()).startsWith(expected.get("prefix").asString())
				.endsWith(expected.path("suffix").asString(""));
		assertThat(published.text().codePointCount(0, published.text().length())).isEqualTo(expected.get("length").asInt());
	}

	@ParameterizedTest(name = "{0}")
	@MethodSource("styleCases")
	void 画像の種類ごとの扱い_BR_005_01(JsonNode c) {
		ImageStyle style = ImageStyle.valueOf(c.get("code").asString());
		assertThat(style.showsCaution()).isEqualTo(c.get("showsCaution").asBoolean());
		assertThat(style.needsApprovalCheck()).isEqualTo(c.get("needsApprovalCheck").asBoolean());
		assertThat(style.requiresAiDisclosure()).isEqualTo(c.get("requiresAiDisclosure").asBoolean());
	}

	@ParameterizedTest(name = "{0}")
	@MethodSource("imageCases")
	void 画像仕様(JsonNode c) {
		PostMedia media = new PostMedia(1, "t/posts/a.jpg", c.get("width").asInt(), c.get("height").asInt(), c.get("bytes").asLong());
		assertThat(new ImageSpec().violationsOf(media)).hasSize(c.get("violations").asInt());
	}

	@ParameterizedTest(name = "{0}")
	@MethodSource("mediaCountCases")
	void 投稿画像の枚数_AC_001_07(JsonNode c) {
		PostMediaList list = new PostMediaList(IntStream.rangeClosed(1, c.get("count").asInt())
				.mapToObj(i -> new PostMedia(i, "t/posts/" + i + ".jpg", 1080, 1350, 500_000)).toList());
		boolean accepted = list.violationsFor(PostFormat.valueOf(c.get("format").asString()), new ImageSpec()).isEmpty();
		assertThat(accepted).isEqualTo(c.get("accepted").asBoolean());
	}

	@ParameterizedTest(name = "{0}")
	@MethodSource("scheduleCases")
	void 予約日時の確定_AC_001_11(JsonNode c) {
		Instant value = NOW.plus(Duration.ofMinutes(c.get("offsetMinutes").asLong()));
		if (c.get("accepted").asBoolean()) {
			assertThat(ScheduledAt.decide(value, NOW).toInstant()).isEqualTo(value);
		} else {
			assertThatThrownBy(() -> ScheduledAt.decide(value, NOW)).isInstanceOf(IllegalArgumentException.class);
		}
	}

	@ParameterizedTest(name = "{0}")
	@MethodSource("statusPairs")
	void 投稿状態の遷移_BR_001_07(PostStatus from, PostStatus to) {
		JsonNode allowed = fixture("post-status.json").get("transitions").get(from.name());
		boolean expected = false;
		for (JsonNode n : allowed) {
			expected |= n.asString().equals(to.name());
		}
		assertThat(from.canTransitTo(to)).isEqualTo(expected);
	}

	static Stream<org.junit.jupiter.params.provider.Arguments> statusPairs() {
		return Stream.of(PostStatus.values()).flatMap(from -> Stream.of(PostStatus.values())
				.map(to -> org.junit.jupiter.params.provider.Arguments.of(from, to)));
	}
}
