package jp.co.keai.niijimaig.post.application;

import java.time.Duration;
import java.util.List;

import org.springframework.stereotype.Component;

/** 公開で使う外部との接点（Instagram・途中経過の記録・保存先）と、同じ試行内の再試行の作り方 */
@Component
public class PublishingCollaborators {

	private final InstagramPublisher instagram;
	private final PublishingLog log;
	private final MediaStorage storage;
	private final InAttemptRetry.Sleeper sleeper;
	private final List<Duration> backoff;

	public PublishingCollaborators(InstagramPublisher instagram, PublishingLog log, MediaStorage storage,
			InAttemptRetry.Sleeper sleeper) {
		this.instagram = instagram;
		this.log = log;
		this.storage = storage;
		this.sleeper = sleeper;
		this.backoff = InAttemptRetry.DEFAULT_BACKOFF;
	}

	InAttemptRetry newRetry() {
		return new InAttemptRetry(backoff, sleeper);
	}

	InstagramPublisher instagram() {
		return instagram;
	}

	PublishingLog log() {
		return log;
	}

	MediaStorage storage() {
		return storage;
	}
}
