package jp.co.keai.niijimaig.post.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import jp.co.keai.niijimaig.post.domain.Post.ApprovedContent;
import jp.co.keai.niijimaig.post.domain.Post.PublishingStep;

class PostPublishingStepTest {

	static final Instant TEN_OCLOCK = Instant.parse("2026-11-03T01:00:00Z"); // 日本時間 10:00
	final PublishGrace grace = new PublishGrace(PublishGrace.DEFAULT);

	@Test
	@DisplayName("AC-001-12 予約日時を過ぎた予約中の投稿は公開を始める")
	void startsWhenDue() {
		Post post = scheduledAt(TEN_OCLOCK);

		PublishingStep step = post.nextStep(TEN_OCLOCK.plus(Duration.ofMinutes(14)), grace);

		assertThat(step).isInstanceOf(PublishingStep.Start.class);
		PostEvent started = ((PublishingStep.Start) step).event();
		assertThat(started.to()).isEqualTo(PostStatus.PUBLISHING);
		assertThat(post.apply(started).published().to()).isEqualTo(PostStatus.PUBLISHED);
	}

	@Test
	void 予約日時の前は何もしない() {
		assertThat(scheduledAt(TEN_OCLOCK).nextStep(TEN_OCLOCK.minusSeconds(1), grace))
				.isInstanceOf(PublishingStep.Skip.class);
	}

	@Test
	@DisplayName("AC-001-13 公開猶予（6時間）ちょうどは公開し、6時間1分過ぎたら失敗（公開猶予切れ）")
	void graceBoundary() {
		Post post = scheduledAt(TEN_OCLOCK);

		assertThat(post.nextStep(TEN_OCLOCK.plus(Duration.ofHours(6)), grace)).isInstanceOf(PublishingStep.Start.class);
		PublishingStep late = post.nextStep(TEN_OCLOCK.plus(Duration.ofHours(6).plusMinutes(1)), grace);
		assertThat(late).isInstanceOf(PublishingStep.Expire.class);
		assertThat(((PublishingStep.Expire) late).event().to()).isEqualTo(PostStatus.FAILED);
	}

	@Test
	@DisplayName("AC-001-15 公開処理中のまま残った投稿は、中断した公開を確かめる")
	void recoversInterruptedPublishing() {
		Post interrupted = scheduledAt(TEN_OCLOCK).apply(startEvent());

		assertThat(interrupted.nextStep(TEN_OCLOCK.plus(Duration.ofHours(1)), grace))
				.isInstanceOf(PublishingStep.Recover.class);
	}

	@Test
	void 予約を取り消された投稿は公開しない() {
		Post cancelled = new Post(identity(), PostStatus.DRAFT, content(), ScheduledAt.restore(TEN_OCLOCK));

		assertThat(cancelled.nextStep(TEN_OCLOCK, grace)).isInstanceOf(PublishingStep.Skip.class);
	}

	@Test
	@DisplayName("BR-001-09 上限超過は公開延期で予約中に戻す")
	void deferral() {
		Post publishing = scheduledAt(TEN_OCLOCK).apply(startEvent());

		PostEvent deferred = publishing.deferred(FailureReason.of(FailureKind.RATE_LIMITED));

		assertThat(deferred.to()).isEqualTo(PostStatus.SCHEDULED);
		assertThat(FailureKind.RATE_LIMITED.deferrable()).isTrue();
	}

	@Test
	@DisplayName("AC-001-16 AC-001-17 一時的なエラーは同じ試行内でリトライし、連携切れはリトライしない")
	void retryPolicy() {
		assertThat(FailureKind.TRANSIENT.retryableInSameAttempt()).isTrue();
		assertThat(FailureKind.TOKEN_INVALID.retryableInSameAttempt()).isFalse();
		assertThat(FailureKind.TOKEN_INVALID.guidance()).contains("連携をやり直してください");
	}

	@Test
	@DisplayName("AC-001-11 予約日時は確定時点で未来かつ1年以内")
	void scheduledAtDecision() {
		Instant now = TEN_OCLOCK;

		assertThat(ScheduledAt.decide(now.plusSeconds(60), now).isDue(now)).isFalse();
		assertThatThrownBy(() -> ScheduledAt.decide(now.minusSeconds(1), now)).hasMessageContaining("現在より後");
		assertThatThrownBy(() -> ScheduledAt.decide(now.plus(Duration.ofDays(366)), now)).hasMessageContaining("1年以内");
		assertThat(ScheduledAt.immediate(now).isDue(now)).isTrue();
	}

	@Test
	void 出来事は現在の状態からしか適用できない() {
		Post post = scheduledAt(TEN_OCLOCK);

		assertThatThrownBy(() -> post.apply(post.apply(startEvent()).published())).isInstanceOf(IllegalStateException.class);
	}

	private PostEvent startEvent() {
		return ((PublishingStep.Start) scheduledAt(TEN_OCLOCK).nextStep(TEN_OCLOCK, grace)).event();
	}

	static Post scheduledAt(Instant at) {
		return new Post(identity(), PostStatus.SCHEDULED, content(), ScheduledAt.restore(at));
	}

	static Post.Identity identity() {
		return new Post.Identity(UUID.randomUUID(), UUID.randomUUID());
	}

	static ApprovedContent content() {
		return new ApprovedContent(UUID.randomUUID(), PostFormat.CAROUSEL, new Caption("学園祭 #新島info"),
				PrCategory.NONE, PostMediaListTest.portraits(3));
	}
}
