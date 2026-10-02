package jp.co.keai.niijimaig.job.domain;

import java.time.Duration;

/** ジョブ種別。最大試行回数と実行期限（ロックの長さ）を持つ */
public enum JobType {
	PREPARE_MEDIA(3, Duration.ofMinutes(10)),
	PUBLISH_POST(4, Duration.ofMinutes(10)),
	REFRESH_TOKEN(3, Duration.ofMinutes(30)),
	COLLECT_INSIGHTS(3, Duration.ofMinutes(30)),
	COLLECT_NEWS(3, Duration.ofMinutes(30)),
	GENERATE_DRAFTS(2, Duration.ofMinutes(30));

	private final int maxAttempts;
	private final Duration lockDuration;

	JobType(int maxAttempts, Duration lockDuration) {
		this.maxAttempts = maxAttempts;
		this.lockDuration = lockDuration;
	}

	public int maxAttempts() {
		return maxAttempts;
	}

	public Duration lockDuration() {
		return lockDuration;
	}

	/** 同じ確定（予約）に対してジョブを二重に積まないための鍵 */
	public String dedupeKey(Object subject, Object occasion) {
		return name() + ":" + subject + ":" + occasion;
	}
}
