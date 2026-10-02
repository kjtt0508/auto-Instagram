package jp.co.keai.niijimaig.post.domain;

import java.time.Duration;
import java.time.Instant;

/** 公開猶予: 予約日時を過ぎてから自動公開してよい最大の遅れ。超えたら人に判断を戻す（既定6時間・仮置き） */
public final class PublishGrace {

	public static final Duration DEFAULT = Duration.ofHours(6);

	private final Duration allowedDelay;

	public PublishGrace(Duration allowedDelay) {
		if (allowedDelay == null || allowedDelay.isNegative() || allowedDelay.isZero()) {
			throw new IllegalArgumentException("公開猶予は正の長さ");
		}
		this.allowedDelay = allowedDelay;
	}

	public static PublishGrace ofMinutes(int minutes) {
		return new PublishGrace(Duration.ofMinutes(minutes));
	}

	public boolean allowsAutoPublish(ScheduledAt scheduledAt, Instant now) {
		return scheduledAt.delayAt(now).compareTo(allowedDelay) <= 0;
	}

	public String exceededMessage() {
		return "予約日時から" + allowedDelay.toHours() + "時間以上過ぎたため公開しませんでした。日時を決めて再実行してください";
	}
}
