package jp.co.keai.niijimaig.post.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.stream.IntStream;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class PostMediaListTest {

	private final ImageSpec spec = new ImageSpec();

	@ParameterizedTest(name = "カルーセル {0}枚 → 受け付ける={1}")
	@CsvSource({ "1,false", "2,true", "10,true", "11,false" })
	@DisplayName("AC-001-07 カルーセルは2〜10枚")
	void carouselCount(int count, boolean accepted) {
		List<String> violations = portraits(count).violationsFor(PostFormat.CAROUSEL, spec);

		assertThat(violations.isEmpty()).isEqualTo(accepted);
		if (!accepted) {
			assertThat(violations).contains("カルーセルは2〜10枚です");
		}
	}

	@Test
	@DisplayName("AC-001-06 カルーセルで1枚目が4:5、2枚目が1:1なら公開できない（アップロード時にそろえる）")
	void carouselAspectMustMatch() {
		PostMediaList mixed = new PostMediaList(List.of(
				new PostMedia(1, "t/a.jpg", 1080, 1350, 500_000),
				new PostMedia(2, "t/b.jpg", 1080, 1080, 500_000)));

		assertThat(mixed.violationsFor(PostFormat.CAROUSEL, spec))
				.contains("カルーセルの画像は1枚目と同じ縦横比にそろえてください");
	}

	@Test
	@DisplayName("AC-001-04 画像仕様: 幅1440以下・8MB以下・4:5〜1.91:1")
	void imageSpec() {
		assertThat(spec.isSatisfiedBy(new PostMedia(1, "t/a.jpg", 1440, 1800, 8 * 1024 * 1024))).isTrue();
		assertThat(spec.violationsOf(new PostMedia(1, "t/a.jpg", 4032, 3024, 5_000_000)))
				.containsExactly("画像の幅は320〜1440pxです");
		assertThat(spec.violationsOf(new PostMedia(1, "t/a.jpg", 1080, 1920, 500_000)))
				.containsExactly("画像の縦横比は4:5〜1.91:1です");
		assertThat(spec.violationsOf(new PostMedia(1, "t/a.jpg", 1080, 1350, 8 * 1024 * 1024 + 1)))
				.containsExactly("画像は8MB以下です");
	}

	@Test
	void 順番は1から連番() {
		assertThatThrownBy(() -> new PostMediaList(List.of(new PostMedia(2, "t/a.jpg", 1080, 1350, 1))))
				.hasMessageContaining("連番");
	}

	static PostMediaList portraits(int count) {
		return new PostMediaList(IntStream.rangeClosed(1, count)
				.mapToObj(i -> new PostMedia(i, "t/" + i + ".jpg", 1080, 1350, 500_000))
				.toList());
	}
}
