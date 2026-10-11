package jp.co.keai.niijimaig.post.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

import tools.jackson.databind.JsonNode;

/**
 * アクセント色（7色。REQ-006）を、画面（TS）と同じ共通テストケース docs/model/fixtures/accent-colors.json で確かめる（ADR-0005）。
 * 新しい4色の白との明るさの比（3:1 以上）は TS のテストだけが計算して確かめる（二重実装にしない。REQ-006 設計 2章）。
 * ここでは Java の AccentColor が同じ値を持つことを確かめる（値が同じなら、その比は Java でも成り立つ）
 */
class AccentColorTest {

	static Stream<JsonNode> colorCases() { return SharedFixtureCasesTest.cases("accent-colors.json", "colors"); }

	private static List<String> codesOf(String field) {
		List<String> codes = new ArrayList<>();
		SharedFixtureCasesTest.fixture("accent-colors.json").get(field).forEach(n -> codes.add(n.asString()));
		return codes;
	}

	@Test
	@DisplayName("AC-006-01 BR-006-01 アクセント色は紫・赤・青緑・青・緑・オレンジ・ピンクの7色（共通テストケースと同じ並び）")
	void sevenColorsInTheSameOrderAsTheFixture() {
		List<String> expectedCodes = new ArrayList<>();
		SharedFixtureCasesTest.fixture("accent-colors.json").get("colors").forEach(c -> expectedCodes.add(c.get("code").asString()));

		assertThat(AccentColor.values()).extracting(AccentColor::name).containsExactlyElementsOf(expectedCodes);
		assertThat(AccentColor.values()).extracting(AccentColor::label)
				.containsExactly("紫", "赤", "青緑", "青", "緑", "オレンジ", "ピンク");
	}

	@ParameterizedTest(name = "{0}")
	@MethodSource("colorCases")
	@DisplayName("AC-006-01 NFR-006-02 コード・名前・帯の左端と右端の値は共通テストケースと同じ")
	void valuesMatchFixture(JsonNode c) {
		AccentColor color = AccentColor.find(c.get("code").asString()).orElseThrow();

		assertThat(color.label()).isEqualTo(c.get("name").asString());
		assertThat(color.startColor()).isEqualTo(c.get("start").asString());
		assertThat(color.endColor()).isEqualTo(c.get("end").asString());
	}

	@Test
	@DisplayName("AC-006-01 7色以外のコード（黄 YELLOW・水色・名前の「緑」・小文字・空）は知らない色")
	void unknownCodesAreNotColors() {
		for (String code : codesOf("unknownCodes")) {
			assertThat(AccentColor.find(code)).as(code).isEmpty();
			assertThatThrownBy(() -> CoverText.restore(new CoverText.Parts("同志社大学", "期末試験", "", "まとめたよ", code)))
					.isInstanceOf(IllegalArgumentException.class);
		}
		assertThat(AccentColor.find(null)).isEmpty();
	}

	@Test
	@DisplayName("BR-002-12 AC-006-03 紫は単色、ほかの色は左端と右端が違うグラデーション。旧3色（承認済み・公開済みの投稿の色）の値は公開中の投稿から読み取ったまま変わらない")
	void purpleIsSolidAndTheOthersAreGradients() {
		assertThat(AccentColor.PURPLE.startColor()).isEqualTo(AccentColor.PURPLE.endColor());
		for (AccentColor color : AccentColor.values()) {
			if (color != AccentColor.PURPLE) {
				assertThat(color.startColor()).as(color.name()).isNotEqualTo(color.endColor());
			}
		}
		assertThat(AccentColor.RED.startColor()).isEqualTo("#FD3432");
		assertThat(AccentColor.RED.endColor()).isEqualTo("#FE914C");
		assertThat(AccentColor.TEAL.startColor()).isEqualTo("#19BBAA");
		assertThat(AccentColor.TEAL.endColor()).isEqualTo("#066A85");
	}
}
