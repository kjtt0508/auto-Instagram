package jp.co.keai.niijimaig.post.domain;

import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;

/**
 * 予約日時。確定時点では未来かつ1年以内（decide）。再実行の「今すぐ」は immediate。
 * 記録から戻すとき（restore）は検査しない（公開時には過去になっているのが正常）。
 */
public final class ScheduledAt {

	static final Duration MAX_AHEAD = Duration.ofDays(365);

	private final Instant value;

	private ScheduledAt(Instant value) {
		if (value == null) {
			throw new IllegalArgumentException("予約日時は必須");
		}
		this.value = value.truncatedTo(ChronoUnit.SECONDS);
	}

	public static ScheduledAt decide(Instant value, Instant now) {
		if (!value.isAfter(now)) {
			throw new IllegalArgumentException("予約日時は現在より後にしてください");
		}
		if (value.isAfter(now.plus(MAX_AHEAD))) {
			throw new IllegalArgumentException("予約日時は1年以内にしてください");
		}
		return new ScheduledAt(value);
	}

	public static ScheduledAt immediate(Instant now) {
		return new ScheduledAt(now);
	}

	public static ScheduledAt restore(Instant value) {
		return new ScheduledAt(value);
	}

	public boolean isDue(Instant now) {
		return !value.isAfter(now);
	}

	Duration delayAt(Instant now) {
		return Duration.between(value, now);
	}

	public Instant toInstant() {
		return value;
	}
}
