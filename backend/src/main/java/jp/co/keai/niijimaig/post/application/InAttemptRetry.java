package jp.co.keai.niijimaig.post.application;

import java.time.Duration;
import java.util.List;
import java.util.function.Supplier;

/**
 * 同じ試行の中での再試行。失敗区分が「同じ試行内でリトライ可」のときだけ、間隔を空けて繰り返す（BR-001-09）。
 * 再試行した回数を数え、ジョブの試行結果に残す（AC-001-16）。
 */
public final class InAttemptRetry {

	static final List<Duration> DEFAULT_BACKOFF = List.of(Duration.ofSeconds(10), Duration.ofSeconds(30), Duration.ofSeconds(90));

	private final List<Duration> backoff;
	private final Sleeper sleeper;
	private int retries;

	public InAttemptRetry(List<Duration> backoff, Sleeper sleeper) {
		this.backoff = List.copyOf(backoff);
		this.sleeper = sleeper;
	}

	public <T> T call(Supplier<T> operation) {
		for (int i = 0;; i++) {
			try {
				return operation.get();
			} catch (InstagramApiException e) {
				if (!e.kind().retryableInSameAttempt() || i >= backoff.size()) {
					throw e;
				}
				retries++;
				sleeper.sleep(backoff.get(i));
			}
		}
	}

	public int retries() {
		return retries;
	}

	public Sleeper sleeper() {
		return sleeper;
	}

	@FunctionalInterface
	public interface Sleeper {
		void sleep(Duration duration);
	}
}
