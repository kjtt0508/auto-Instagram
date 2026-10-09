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
				SlideSamples.slides(List.of(SlideSamples.body(material))), SlideSamples.TEMPLATE_VERSION, SlideSamples.settings(), additional);
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
				SlideSamples.TEMPLATE_VERSION, SlideSamples.settings(), List.of());
		PostRevision pr = PostRevision.ofSlides(new Caption("あいう"), PrCategory.PR, SlideSamples.slides(List.of(SlideSamples.body(Optional.empty()))),
				SlideSamples.TEMPLATE_VERSION, SlideSamples.settings(), List.of());

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
	@DisplayName("AC-002-02 画像化の計画は、スライドごとに必要な画像だけを持つ（表紙は背景写真、中は素材画像、最後は過去の投稿の表紙）。アップロードの投稿には無い")
	void renderPlanHasImagesPerSlide() {
		PastPostCover past = PastPostCover.restore(java.util.UUID.randomUUID(), "t/posts/p2/1.jpg");
		RevisionContent.RenderPlan plan = revision(SlideSamples.body(Optional.of(SlideSamples.material(ImageStyle.ILLUSTRATION))))
				.renderPlan(List.of(past)).orElseThrow();

		assertThat(plan.templateVersion()).isEqualTo(SlideSamples.TEMPLATE_VERSION);
		assertThat(plan.settings()).containsEntry("bandText", "テスト帯");
		assertThat(plan.slides()).extracting(RevisionContent.RenderPlan.SlideRender::imageRefs).containsExactly(
				List.of("t/backgrounds/1.jpg"), List.of("t/materials/1.jpg"), List.of("t/posts/p2/1.jpg"));
		assertThat(plan.slides().get(1).values()).containsEntry("role", "BODY");
		PostRevision photos = PostRevision.ofPhotos(new Caption("本文"), PrCategory.NONE, new PostMediaList(List.of()));
		assertThat(photos.renderPlan(List.of())).isEmpty();
	}

	@Test
	@DisplayName("AC-002-02 ロゴは最後のスライドだけが使うので、最後のスライドの画像の参照にだけ入る")
	void logoBelongsToClosingSlide() {
		PostStyleSettings base = SlideSamples.settings();
		PostStyleSettings withLogo = new PostStyleSettings(java.util.UUID.randomUUID(), 1, "帯", List.of("同志社大学"), "ありがとう", "@a",
				base.captionFooter(), base.fixedHashtags(), Optional.of("t/style/logo.png"));
		PostRevision revision = PostRevision.ofSlides(new Caption("本文"), PrCategory.NONE,
				SlideSamples.slides(List.of(SlideSamples.body(Optional.empty()))), SlideSamples.TEMPLATE_VERSION, withLogo, List.of());

		RevisionContent.RenderPlan plan = revision.renderPlan(List.of()).orElseThrow();

		assertThat(plan.slides()).extracting(RevisionContent.RenderPlan.SlideRender::imageRefs).containsExactly(
				List.of("t/backgrounds/1.jpg"), List.of(), List.of("t/style/logo.png"));
		assertThat(plan.settings()).containsEntry("logo", "t/style/logo.png");
	}

	@Test
	@DisplayName("AC-002-02 準備が済んでいるかは、準備済みの枚数が承認された版の枚数に届いているかで決まる（足りなければ途中）")
	void isPreparedWith() {
		PostRevision template = revision(SlideSamples.body(Optional.empty()));
		Post post = new Post(new Post.Identity(java.util.UUID.randomUUID(), java.util.UUID.randomUUID()), PostStatus.SCHEDULED,
				new Post.ApprovedContent(java.util.UUID.randomUUID(), PostFormat.CAROUSEL, template),
				ScheduledAt.restore(java.time.Instant.parse("2026-11-03T01:00:00Z")));

		assertThat(post.isPreparedWith(new PostMediaList(List.of()))).isFalse();
		assertThat(post.isPreparedWith(CaptionTest.oneMedia())).isFalse();
		assertThat(post.isPreparedWith(media(3))).isTrue();
	}

	private static PostMediaList media(int count) {
		List<PostMedia> list = new ArrayList<>();
		for (int i = 1; i <= count; i++) {
			list.add(new PostMedia(i, "t/public/" + i + ".jpg", 1080, 1350, 1000));
		}
		return new PostMediaList(list);
	}

	@Test
	@DisplayName("AC-002-02 公開用画像の枚数と準備のしかたは中身が決める（写真は投稿画像の枚数を複製、テンプレートはスライドの枚数を画像化）")
	void expectedMediaCountAndPreparation() {
		PostRevision photos = PostRevision.ofPhotos(new Caption("本文"), PrCategory.NONE, CaptionTest.mediaOf(null));
		PostRevision template = revision(SlideSamples.body(Optional.empty()));

		assertThat(photos.expectedPublishMediaCount()).isEqualTo(1);
		assertThat(photos.preparation()).isEqualTo(RevisionContent.Preparation.COPY);
		assertThat(template.expectedPublishMediaCount()).isEqualTo(3);
		assertThat(template.preparation()).isEqualTo(RevisionContent.Preparation.RENDER);
	}

	@Test
	@DisplayName("AC-002-19 承認時の確認は、写真風の生成画像を含む中身（投稿画像・素材画像）だけに要る")
	void approvalCheck() {
		assertThat(PostRevision.ofPhotos(new Caption("本文"), PrCategory.NONE, CaptionTest.mediaOf(ImageStyle.PHOTOREALISTIC))
				.needsApprovalCheck()).isTrue();
		assertThat(PostRevision.ofPhotos(new Caption("本文"), PrCategory.NONE, CaptionTest.mediaOf(ImageStyle.ILLUSTRATION))
				.needsApprovalCheck()).isFalse();
		assertThat(revision(SlideSamples.body(Optional.of(SlideSamples.material(ImageStyle.PHOTOREALISTIC)))).needsApprovalCheck()).isTrue();
		assertThat(revision(SlideSamples.body(Optional.of(SlideSamples.material(null)))).needsApprovalCheck()).isFalse();
	}

	@Test
	@DisplayName("AC-002-02 公開の検査は、準備済みの枚数を中身が決める公開用画像の枚数と比べる（テンプレートの投稿はスライドの枚数）")
	void publishingChecksExpectedCount() {
		PostRevision template = revision(SlideSamples.body(Optional.empty()));
		Post post = new Post(new Post.Identity(java.util.UUID.randomUUID(), java.util.UUID.randomUUID()), PostStatus.SCHEDULED,
				new Post.ApprovedContent(java.util.UUID.randomUUID(), PostFormat.CAROUSEL, template),
				ScheduledAt.restore(java.time.Instant.parse("2026-11-03T01:00:00Z")));

		assertThat(post.violationsForPublishing(CaptionTest.oneMedia(), new ImageSpec(), PR_LABEL))
				.containsExactly("公開用画像の枚数が承認された版と一致しません");
	}

	@Test
	@DisplayName("AC-002-17 投稿の版の各要素は必須。追加のハッシュタグは0〜5個で、どれもハッシュタグの形")
	void revisionGuards() {
		SlideList slides = SlideSamples.slides(List.of(SlideSamples.body(Optional.empty())));
		PostStyleSettings settings = SlideSamples.settings();
		String v = SlideSamples.TEMPLATE_VERSION;
		assertThatThrownBy(() -> PostRevision.ofSlides(null, PrCategory.NONE, slides, v, settings, List.of()))
				.isInstanceOf(IllegalArgumentException.class);
		assertThatThrownBy(() -> PostRevision.ofSlides(new Caption("本文"), null, slides, v, settings, List.of()))
				.isInstanceOf(IllegalArgumentException.class);
		assertThatThrownBy(() -> PostRevision.ofSlides(new Caption("本文"), PrCategory.NONE, null, v, settings, List.of()))
				.isInstanceOf(IllegalArgumentException.class);
		assertThatThrownBy(() -> PostRevision.ofSlides(new Caption("本文"), PrCategory.NONE, slides, " ", settings, List.of()))
				.isInstanceOf(IllegalArgumentException.class);
		assertThatThrownBy(() -> PostRevision.ofSlides(new Caption("本文"), PrCategory.NONE, slides, v, null, List.of()))
				.isInstanceOf(IllegalArgumentException.class);
		assertThatThrownBy(() -> PostRevision.ofSlides(new Caption("本文"), PrCategory.NONE, slides, v, settings, null))
				.isInstanceOf(IllegalArgumentException.class);
		assertThatThrownBy(() -> PostRevision.ofPhotos(new Caption("本文"), PrCategory.NONE, null))
				.isInstanceOf(IllegalArgumentException.class);

		List<String> five = List.of("#a", "#b", "#c", "#d", "#e");
		assertThat(PostRevision.ofSlides(new Caption("本文"), PrCategory.NONE, slides, v, settings, five).publishCaption(PR_LABEL).text())
				.contains("#e");
		assertThatThrownBy(() -> PostRevision.ofSlides(new Caption("本文"), PrCategory.NONE, slides, v, settings,
				List.of("#a", "#b", "#c", "#d", "#e", "#f"))).hasMessageContaining("追加のハッシュタグは5個までです（6個）");
		assertThatThrownBy(() -> PostRevision.ofSlides(new Caption("本文"), PrCategory.NONE, slides, v, settings, List.of("学割")))
				.hasMessageContaining("ハッシュタグの形が正しくありません");
	}

	@Test
	@DisplayName("AC-002-17 記録から戻す restoreSlides は追加のハッシュタグを検査せず、違反は violations() で返す。公開は止まる")
	void restoreDoesNotCheckHashtags() {
		SlideList slides = SlideSamples.slides(List.of(SlideSamples.body(Optional.empty())));
		PostRevision restored = PostRevision.restoreSlides(new Caption("本文"), PrCategory.NONE, slides, SlideSamples.TEMPLATE_VERSION,
				SlideSamples.settings(), List.of("#a", "#b", "#c", "#d", "#e", "#f", "学割"));

		assertThat(restored.violations()).containsExactly("追加のハッシュタグは5個までです（7個）", "ハッシュタグの形が正しくありません: 学割");
		assertThat(restored.publishCaption(PR_LABEL).text()).contains("#f").doesNotContain("学割");
		Post post = new Post(new Post.Identity(java.util.UUID.randomUUID(), java.util.UUID.randomUUID()), PostStatus.SCHEDULED,
				new Post.ApprovedContent(java.util.UUID.randomUUID(), PostFormat.CAROUSEL, restored),
				ScheduledAt.restore(java.time.Instant.parse("2026-11-03T01:00:00Z")));
		assertThat(post.violationsForPublishing(CaptionTest.oneMedia(), new ImageSpec(), PR_LABEL))
				.contains("追加のハッシュタグは5個までです（7個）");
	}

	@Test
	@DisplayName("AC-002-15 過去の投稿の表紙・スライドの文言・表紙の文言は、検査する of か記録から戻す restore で作る")
	void creationPaths() {
		var own = java.util.UUID.randomUUID();
		assertThatThrownBy(() -> PastPostCover.of(own, "t/a.jpg", own)).hasMessageContaining("投稿自身");
		assertThatThrownBy(() -> PastPostCover.restore(null, "t/a.jpg")).isInstanceOf(IllegalArgumentException.class);
		assertThatThrownBy(() -> SlideText.of("", "説明", List.of())).isInstanceOf(IllegalArgumentException.class);
		assertThat(SlideText.restore("", "説明", List.of()).heading()).isEmpty();
		assertThatThrownBy(() -> SlideText.restore(null, "説明", List.of())).isInstanceOf(IllegalArgumentException.class);
		assertThatThrownBy(() -> CoverText.restore(new CoverText.Parts("同志社大学", "期末試験", "", "まとめたよ", "GREEN")))
				.isInstanceOf(IllegalArgumentException.class);
		assertThat(CoverText.restore(new CoverText.Parts("対象外", "期末試験", "", "まとめたよ", "RED")).target()).isEqualTo("対象外");
		assertThatThrownBy(() -> CoverText.of(new CoverText.Parts("対象外", "期末試験", "", "まとめたよ", "RED"), SlideSamples.settings()))
				.isInstanceOf(IllegalArgumentException.class);
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

	static Stream<JsonNode> hashtagMerges() { return SharedFixtureCasesTest.cases("caption.json", "hashtagMerges"); }

	@ParameterizedTest(name = "{0}")
	@MethodSource("hashtagMerges")
	@DisplayName("AC-002-17 固定ハッシュタグと追加分の並び（形が正しくない追加分は並べない。画面と同じ共通テストケース）")
	void hashtagMerge(JsonNode c) {
		List<String> fixed = new ArrayList<>();
		c.get("fixed").forEach(n -> fixed.add(n.asString()));
		List<String> additional = new ArrayList<>();
		c.get("additional").forEach(n -> additional.add(n.asString()));
		List<String> merged = new ArrayList<>();
		c.get("merged").forEach(n -> merged.add(n.asString()));

		assertThat(new FixedHashtags(fixed).mergedWith(additional)).containsExactlyElementsOf(merged);
	}

	private static PostRevision revision(BodyContent body) {
		return PostRevision.ofSlides(new Caption("本文"), PrCategory.NONE, SlideSamples.slides(List.of(body)), SlideSamples.TEMPLATE_VERSION,
				SlideSamples.settings(), List.of());
	}
}
