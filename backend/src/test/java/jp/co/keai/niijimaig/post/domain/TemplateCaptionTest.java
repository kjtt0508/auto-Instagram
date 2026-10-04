package jp.co.keai.niijimaig.post.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.stream.Stream;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

import tools.jackson.databind.JsonNode;

/** テンプレートの投稿の公開用キャプションを、画面（TS）と同じ共通テストケース（caption.json の templateCases）で確かめる（ADR-0005） */
class TemplateCaptionTest {

	static final String PR_LABEL = "【PR】\n";

	static Stream<JsonNode> templateCases() { return SharedFixtureCasesTest.cases("caption.json", "templateCases"); }

	private static PostRevision revisionOf(JsonNode c) {
		StringBuilder body = new StringBuilder(c.has("body") ? c.get("body").asString() : "");
		c.path("segments").forEach(s -> body.append(s.get("repeat").asString().repeat(s.get("count").asInt())));
		List<String> additional = new ArrayList<>();
		c.get("additionalHashtags").forEach(n -> additional.add(n.asString()));
		Optional<MaterialImage> material = c.path("aiDisclosure").asBoolean(false)
				? Optional.of(SlideSamples.material(ImageStyle.PHOTOREALISTIC)) : Optional.empty();
		return PostRevision.ofSlides(new Caption(body.toString()), PrCategory.valueOf(c.get("prCategory").asString()),
				SlideSamples.slides(List.of(SlideSamples.body(material))), SlideSamples.settings(), additional);
	}

	@ParameterizedTest(name = "{0}")
	@MethodSource("templateCases")
	@DisplayName("AC-002-17 AC-002-18 テンプレートの投稿の公開用キャプション")
	void templatePublishCaption(JsonNode c) {
		PublishCaption published = revisionOf(c).publishCaption(PR_LABEL);

		assertThat(published.violations().isEmpty()).isEqualTo(c.get("publishValid").asBoolean());
		if (!c.get("publishValid").asBoolean()) {
			assertThat(published.violations()).contains(c.get("violation").asString());
			assertThatThrownBy(published::toCaption).isInstanceOf(IllegalArgumentException.class);
			return;
		}
		JsonNode expected = c.path("publishText");
		if (expected.has("text")) {
			assertThat(published.text()).isEqualTo(expected.get("text").asString());
		}
		if (expected.has("length")) {
			assertThat(published.length()).isEqualTo(expected.get("length").asInt());
		}
		assertThat(published.toCaption().text()).isEqualTo(published.text());
	}

	@Test
	@DisplayName("AC-002-18 キャプション本文に使える文字数は、付記・定型・ハッシュタグを除いた分（本文の長さによらない）")
	void remainingForCaption() {
		PostRevision plain = PostRevision.ofSlides(new Caption("あ"), PrCategory.NONE, SlideSamples.slides(List.of(SlideSamples.body(Optional.empty()))),
				SlideSamples.settings(), List.of());
		PostRevision pr = PostRevision.ofSlides(new Caption("あいう"), PrCategory.PR, SlideSamples.slides(List.of(SlideSamples.body(Optional.empty()))),
				SlideSamples.settings(), List.of());

		assertThat(plain.publishCaption(PR_LABEL).remainingForCaption()).isEqualTo(2114);
		assertThat(pr.publishCaption(PR_LABEL).remainingForCaption()).isEqualTo(2109);
	}

	@Test
	@DisplayName("BR-002-16 生成の時点では、写真風を含むか分からないので、AI生成の表示の18文字を常に見込める")
	void assumedDisclosure() {
		assertThat(AiDisclosure.assumingRequired().suffix()).isEqualTo("\n※画像はAIで生成したイメージです");
		assertThat(AiDisclosure.assumingRequired().suffix().codePointCount(0, AiDisclosure.assumingRequired().suffix().length())).isEqualTo(18);
	}

	@Test
	@DisplayName("AC-002-19 スライド構成の素材画像に写真風の生成画像を含むとAI生成の表示が要る。背景・イラスト・人が差し替えた画像には要らない")
	void aiDisclosureFromSlides() {
		BodyContent photo = SlideSamples.body(Optional.of(SlideSamples.material(ImageStyle.PHOTOREALISTIC)));
		BodyContent illustration = SlideSamples.body(Optional.of(SlideSamples.material(ImageStyle.ILLUSTRATION)));
		BodyContent replaced = SlideSamples.body(Optional.of(SlideSamples.material(null)));
		assertThat(revision(photo).aiDisclosure().isRequired()).isTrue();
		assertThat(revision(illustration).aiDisclosure().isRequired()).isFalse();
		assertThat(revision(replaced).aiDisclosure().isRequired()).isFalse();
		assertThat(revision(photo).publishCaption(PR_LABEL).text()).contains(AiDisclosure.TEXT);
	}

	@Test
	@DisplayName("AC-002-02 版の画像の参照は背景写真・素材画像（と設定のロゴ）。過去の投稿の表紙は含まない。アップロードの投稿には無い")
	void imageRefs() {
		assertThat(revision(SlideSamples.body(Optional.of(SlideSamples.material(ImageStyle.ILLUSTRATION)))).imageRefs())
				.containsExactly("t/backgrounds/1.jpg", "t/materials/1.jpg");
		PostRevision photos = PostRevision.ofPhotos(new Caption("本文"), PrCategory.NONE, new PostMediaList(List.of()));
		assertThat(photos.imageRefs()).isEmpty();
		assertThat(photos.slides()).isEmpty();
	}

	@Test
	@DisplayName("AC-002-23 画像化の失敗(RENDER_FAILED)は自動リトライも延期もせず、やり直せることを案内する")
	void renderFailed() {
		assertThat(FailureKind.RENDER_FAILED.retryableInSameAttempt()).isFalse();
		assertThat(FailureKind.RENDER_FAILED.deferrable()).isFalse();
		assertThat(FailureKind.RENDER_FAILED.guidance()).isEqualTo("画像化に失敗しました。今すぐ再実行でやり直せます");
	}

	@Test
	@DisplayName("AC-002-17 固定ハッシュタグ: 追加のハッシュタグと合わせて重複を除く（全角＃も同じ）。形が違うものは作れない")
	void fixedHashtags() {
		FixedHashtags fixed = new FixedHashtags(List.of("#同志社大学", "#同志社"));
		assertThat(fixed.mergedWith(List.of("#学割", "#同志社", "＃同志社大学", "#京都"))).containsExactly("#同志社大学", "#同志社", "#学割", "#京都");
		assertThatThrownBy(() -> new FixedHashtags(List.of("同志社"))).isInstanceOf(IllegalArgumentException.class);
		assertThatThrownBy(() -> new CaptionFooter(" ")).isInstanceOf(IllegalArgumentException.class);
	}

	private static PostRevision revision(BodyContent body) {
		return PostRevision.ofSlides(new Caption("本文"), PrCategory.NONE, SlideSamples.slides(List.of(body)), SlideSamples.settings(), List.of());
	}
}
