package jp.co.keai.niijimaig.post.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

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
		Caption body = new Caption("あ".repeat(2196));
		String label = "【PR】\n"; // 5文字

		assertThatThrownBy(() -> PrCategory.PR.applyLabel(body, label)).hasMessageContaining("2200文字以内");
		assertThat(PrCategory.PR.applyLabel(new Caption("あ".repeat(2195)), label).text()).hasSize(2200);
		assertThat(PrCategory.NONE.applyLabel(body, label)).isEqualTo(body);
		assertThat(PrCategory.PR.applyLabel(new Caption("学園祭"), label).text()).isEqualTo("【PR】\n学園祭");
	}

	private String tags(int count) {
		StringBuilder text = new StringBuilder("お知らせ");
		for (int i = 0; i < count; i++) {
			text.append(" #tag").append(i);
		}
		return text.toString();
	}
}
