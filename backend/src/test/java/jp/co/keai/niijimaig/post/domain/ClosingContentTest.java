package jp.co.keai.niijimaig.post.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 最後のスライドの中身・最後のスライドの画像・最後のスライドの画像一覧の不変条件と作り方（REQ-007。差し込み値の共通テストケースは SlideFixtureTest） */
class ClosingContentTest {

	private static PastPostCover cover(String path) {
		return PastPostCover.restore(UUID.randomUUID(), path);
	}

	@Test
	@DisplayName("AC-007-05 最後のスライドの画像一覧は0〜2枚で、同じ保存先を重ねない。並べる順の参照を返す")
	void closingImageListInvariants() {
		assertThat(ClosingImageList.empty().refs()).isEmpty();
		assertThat(SlideSamples.closingImages("t/style/c1.jpg", "t/style/c2.jpg").refs()).containsExactly("t/style/c1.jpg", "t/style/c2.jpg");
		assertThatThrownBy(() -> SlideSamples.closingImages("t/style/c1.jpg", "t/style/c2.jpg", "t/style/c3.jpg"))
				.hasMessageContaining("2枚まで");
		assertThatThrownBy(() -> SlideSamples.closingImages("t/style/c1.jpg", "t/style/c1.jpg")).hasMessageContaining("重ねられません");
		assertThatThrownBy(() -> ClosingImage.restore(" ")).isInstanceOf(IllegalArgumentException.class);
		assertThatThrownBy(() -> ClosingImage.restore(null)).isInstanceOf(IllegalArgumentException.class);
		assertThat(ClosingContent.MAX_IMAGES).isEqualTo(2);
	}

	@Test
	@DisplayName("AC-007-05 設定の画像から作ると、並べる順の参照になり、見つからないときの理由は最後のスライドの画像のもの（BR-007-06）")
	void fromClosingImages() {
		ClosingContent content = ClosingContent.fromClosingImages(SlideSamples.closingImages("t/style/c1.jpg", "t/style/c2.jpg"));

		assertThat(content.imageRefs()).containsExactly("t/style/c1.jpg", "t/style/c2.jpg");
		assertThat(content.renderValues()).containsEntry("pastPosts", List.of("t/style/c1.jpg", "t/style/c2.jpg"));
		assertThat(content.imageNeeds()).extracting(RenderImageNeed::missingDetail)
				.containsOnly("最後のスライドの画像が見つかりません。管理者が画像を設定し直したあと、下書きに戻して保存し直してください");
		assertThat(content.imageNeeds()).extracting(RenderImageNeed::fixableByRerun).containsOnly(false);
		assertThat(content.requiresAiDisclosure()).isFalse();
		assertThat(content.needsApprovalCheck()).isFalse();
	}

	@Test
	@DisplayName("AC-007-09 AC-002-15 承認の記録に過去の投稿の表紙があれば記録を使い、設定の画像と混ぜない。理由は今までの文言")
	void fromApprovalPrefersTheRecord() {
		ClosingImageList settings = SlideSamples.closingImages("t/style/c1.jpg", "t/style/c2.jpg");

		ClosingContent two = ClosingContent.fromApproval(List.of(cover("t/posts/p2/1.jpg"), cover("t/posts/p3/1.jpg")), settings);
		ClosingContent one = ClosingContent.fromApproval(List.of(cover("t/posts/p2/1.jpg")), settings);

		assertThat(two.imageRefs()).containsExactly("t/posts/p2/1.jpg", "t/posts/p3/1.jpg");
		assertThat(one.imageRefs()).containsExactly("t/posts/p2/1.jpg");
		assertThat(two.imageNeeds()).extracting(RenderImageNeed::missingDetail).containsOnly("画像化に必要な画像が見つかりません");
		assertThat(two.imageNeeds()).extracting(RenderImageNeed::fixableByRerun).containsOnly(true);
	}

	@Test
	@DisplayName("AC-007-05 AC-007-09 承認の記録が0件なら設定の画像。どちらも無ければ画像の欄なし（改修前の設定の版）")
	void fromApprovalFallsBackToSettings() {
		assertThat(ClosingContent.fromApproval(List.of(), SlideSamples.closingImages("t/style/c1.jpg")).imageRefs())
				.containsExactly("t/style/c1.jpg");
		ClosingContent none = ClosingContent.fromApproval(List.of(), ClosingImageList.empty());
		assertThat(none.imageRefs()).isEmpty();
		assertThat(none.renderValues()).containsEntry("pastPosts", List.of());
		assertThat(ClosingContent.empty().imageRefs()).isEmpty();
	}

	@Test
	@DisplayName("AC-007-09 承認の記録の過去の投稿の表紙は2件まで")
	void recordsAreLimitedToTwo() {
		List<PastPostCover> three = List.of(cover("t/a.jpg"), cover("t/b.jpg"), cover("t/c.jpg"));

		assertThatThrownBy(() -> ClosingContent.fromApproval(three, ClosingImageList.empty())).hasMessageContaining("2件まで");
	}

	@Test
	@DisplayName("AC-007-05 投稿の型の設定は最後のスライドの画像をテンプレートへ渡す設定の値に入れない（最後のスライドの中身として渡す）")
	void settingsRenderValuesDoNotIncludeClosingImages() {
		PostStyleSettings base = SlideSamples.settings();
		PostStyleSettings withImages = new PostStyleSettings(base.tenantId(), 2, base.bandText(), base.coverTargets(), base.closingMessage(),
				base.accountIntroduction(), base.captionFooter(), base.fixedHashtags(), base.logoStoragePath(),
				SlideSamples.closingImages("t/style/c1.jpg"));

		assertThat(withImages.closingImages().refs()).containsExactly("t/style/c1.jpg");
		assertThat(withImages.renderValues()).isEqualTo(base.renderValues());
	}

	@Test
	@DisplayName("AC-007-13 ロゴが見つからないときの理由は今までの文言（最後のスライドの画像の理由とは別）")
	void logoNeedKeepsTheDefaultReason() {
		PostStyleSettings base = SlideSamples.settings();
		PostStyleSettings withLogo = new PostStyleSettings(base.tenantId(), 2, base.bandText(), base.coverTargets(), base.closingMessage(),
				base.accountIntroduction(), base.captionFooter(), base.fixedHashtags(), java.util.Optional.of("t/style/logo.png"),
				ClosingImageList.empty());

		assertThat(base.logoImageNeed()).isEmpty();
		assertThat(withLogo.logoImageNeed()).contains(new RenderImageNeed("t/style/logo.png", "画像化に必要な画像が見つかりません", true));
	}

	@Test
	@DisplayName("AC-007-13 画像化の失敗の説明: 再実行で直るものは「対処方法（詳細）」、直らないものは詳細だけ（対処方法は付けない）")
	void renderFailedMessageDependsOnWhetherARerunFixesIt() {
		FailureReason fixable = FailureReason.renderFailed("画像化に必要な画像が見つかりません", true);
		FailureReason notFixable = FailureReason.renderFailed(ClosingContent.MISSING_CLOSING_IMAGE_DETAIL, false);

		assertThat(fixable.kind()).isEqualTo(FailureKind.RENDER_FAILED);
		assertThat(fixable.message()).isEqualTo("画像化に失敗しました。今すぐ再実行でやり直せます（画像化に必要な画像が見つかりません）");
		assertThat(notFixable.kind()).isEqualTo(FailureKind.RENDER_FAILED);
		assertThat(notFixable.message()).isEqualTo("最後のスライドの画像が見つかりません。管理者が画像を設定し直したあと、下書きに戻して保存し直してください");
	}

	@Test
	@DisplayName("AC-007-05 SlideList.withClosing は最後のスライドの中身だけを差し替える")
	void withClosingReplacesOnlyTheLastSlide() {
		SlideList slides = SlideSamples.slides(List.of(SlideSamples.body(java.util.Optional.empty())));

		SlideList replaced = slides.withClosing(ClosingContent.fromClosingImages(SlideSamples.closingImages("t/style/c1.jpg")));

		assertThat(replaced.count()).isEqualTo(slides.count());
		assertThat(replaced.inOrder().subList(0, 2)).isEqualTo(slides.inOrder().subList(0, 2));
		assertThat(replaced.renderValues().get(2)).containsEntry("role", "CLOSING").containsEntry("pastPosts", List.of("t/style/c1.jpg"));
		assertThat(slides.renderValues().get(2)).containsEntry("pastPosts", List.of());
	}
}
