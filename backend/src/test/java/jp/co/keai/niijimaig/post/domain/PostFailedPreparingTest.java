package jp.co.keai.niijimaig.post.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.api.DisplayName;

/** 公開用画像の準備に失敗したとき、失敗の出来事を作ってよい状態かは投稿が決める（REQ-002 設計 6章） */
class PostFailedPreparingTest {

	private static Post postIn(PostStatus status) {
		PostRevision revision = PostRevision.ofSlides(new Caption("本文"), PrCategory.NONE,
				SlideSamples.slides(List.of(SlideSamples.body(Optional.empty()))), SlideSamples.TEMPLATE_VERSION, SlideSamples.settings(), List.of());
		return new Post(new Post.Identity(UUID.randomUUID(), UUID.randomUUID()), status,
				new Post.ApprovedContent(UUID.randomUUID(), PostFormat.CAROUSEL, revision),
				ScheduledAt.restore(Instant.parse("2026-11-03T01:00:00Z")));
	}

	@ParameterizedTest(name = "{0}")
	@EnumSource(PostStatus.class)
	@DisplayName("AC-002-23 画像化の失敗の出来事を作るのは予約中だけ。下書きに戻された後・公開処理中・公開済みなどでは作らない")
	void failedPreparingOnlyWhileScheduled(PostStatus status) {
		Optional<PostEvent> event = postIn(status).failedPreparing(new FailureReason(FailureKind.RENDER_FAILED, "x"));

		if (status == PostStatus.SCHEDULED) {
			assertThat(event).hasValueSatisfying(e -> {
				assertThat(e.kind()).isEqualTo(PostEvent.Kind.FAILED);
				assertThat(e.from()).isEqualTo(PostStatus.SCHEDULED);
				assertThat(e.to()).isEqualTo(PostStatus.FAILED);
			});
		} else {
			assertThat(event).isEmpty();
		}
	}
}
