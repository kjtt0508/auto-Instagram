package jp.co.keai.niijimaig.post.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class CaptionTest {

	@Test
	@DisplayName("AC-001-08 キャプションは2,200文字まで保存でき、2,201文字はエラー")
	void lengthBoundary() {
		assertThat(new Caption("あ".repeat(2200)).text()).hasSize(2200);
		assertThatThrownBy(() -> new Caption("あ".repeat(2201)))
				.isInstanceOf(IllegalArgumentException.class)
				.hasMessageContaining("2200文字以内");
	}

	@Test
	@DisplayName("AC-001-08 ハッシュタグは30個まで、31個はエラー")
	void hashtagBoundary() {
		assertThat(new Caption(tags(30)).hashtagCount()).isEqualTo(30);
		assertThatThrownBy(() -> new Caption(tags(31))).hasMessageContaining("30個まで");
	}

	@Test
	@DisplayName("絵文字などサロゲートペアは1文字として数える")
	void countsCodePoints() {
		assertThat(new Caption("😀".repeat(2200)).text()).isNotEmpty();
	}

	@Test
	@DisplayName("AC-001-09 PR案件はPR表記を付けた結果も2,200文字以内でなければならない")
	void prLabelCountsTowardLimit() {
		String label = "【PR】\n"; // 5文字

		assertThatThrownBy(() -> post("あ".repeat(2196), PrCategory.PR, ImageStyle.ILLUSTRATION).publishCaption(label))
				.hasMessageContaining("2200文字以内");
		assertThat(post("あ".repeat(2195), PrCategory.PR, null).publishCaption(label).text()).hasSize(2200);
		assertThat(post("学園祭", PrCategory.NONE, null).publishCaption(label).text()).isEqualTo("学園祭");
		assertThat(post("学園祭", PrCategory.PR, null).publishCaption(label).text()).isEqualTo("【PR】\n学園祭");
	}

	@Test
	@DisplayName("AC-005-04 AC-005-10 写真風の生成画像を含むと、末尾に改行とAI生成の表示が付く。背景・イラストには付かない")
	void aiDisclosureAtTheEnd() {
		String label = "【PR】\n";

		assertThat(post("学園祭", PrCategory.PR, ImageStyle.PHOTOREALISTIC).publishCaption(label).text())
				.isEqualTo("【PR】\n学園祭\n※画像はAIで生成したイメージです");
		assertThat(post("学園祭", PrCategory.NONE, ImageStyle.ILLUSTRATION).publishCaption(label).text()).isEqualTo("学園祭");
		assertThat(post("学園祭", PrCategory.NONE, ImageStyle.PHOTOREALISTIC).aiDisclosure().isRequired()).isTrue();
		assertThat(post("学園祭", PrCategory.NONE, ImageStyle.ILLUSTRATION).aiDisclosure().isRequired()).isFalse();
	}

	@Test
	@DisplayName("AC-005-10 付記込みで2,200文字を超えると、公開できない理由に付記の名前と文字数が出る")
	void noticeViolation() {
		Post post = post("あ".repeat(2178), PrCategory.PR, ImageStyle.PHOTOREALISTIC);

		assertThat(post.violationsForPublishing(oneMedia(), new ImageSpec(), "【PR】\n"))
				.containsExactly("PR表記とAI生成の表示を含めて2,200文字以内にしてください（2,201文字）");
	}

	/** 1枚の投稿。style が null なら撮った写真、そうでなければその種類の生成画像 */
	static Post post(String caption, PrCategory category, ImageStyle style) {
		return new Post(new Post.Identity(UUID.randomUUID(), UUID.randomUUID()), PostStatus.SCHEDULED,
				new Post.ApprovedContent(UUID.randomUUID(), PostFormat.FEED_IMAGE, new Caption(caption), category, mediaOf(style)),
				ScheduledAt.restore(Instant.parse("2026-11-03T01:00:00Z")));
	}

	/** 1枚の投稿画像一覧。style が null なら撮った写真、そうでなければその種類の生成画像 */
	static PostMediaList mediaOf(ImageStyle style) {
		Optional<GeneratedImage> generated = Optional.ofNullable(style).map(s -> new GeneratedImage(UUID.randomUUID(), 1, s));
		return new PostMediaList(List.of(new PostMedia(1, "t/posts/a.jpg", 1080, 1350, 500_000, generated)));
	}

	/** 公開用の準備が済んだ1枚 */
	static PostMediaList oneMedia() {
		return mediaOf(null);
	}

	private String tags(int count) {
		StringBuilder text = new StringBuilder("お知らせ");
		for (int i = 0; i < count; i++) {
			text.append(" #tag").append(i);
		}
		return text.toString();
	}
}
