package jp.co.keai.niijimaig.post.application;

import java.util.Optional;

import jp.co.keai.niijimaig.post.domain.FailureReason;
import jp.co.keai.niijimaig.post.domain.PublishResult;

/** Instagram への公開を1回試みた結果 */
public final class PublicationResult {

	enum Outcome {
		PUBLISHED, DEFERRED, FAILED, STILL_PROCESSING
	}

	private final Outcome outcome;
	private final Optional<PublishResult> published;
	private final Optional<FailureReason> reason;

	private PublicationResult(Outcome outcome, Optional<PublishResult> published, Optional<FailureReason> reason) {
		this.outcome = outcome;
		this.published = published;
		this.reason = reason;
	}

	static PublicationResult published(PublishResult result) {
		return new PublicationResult(Outcome.PUBLISHED, Optional.of(result), Optional.empty());
	}

	static PublicationResult failedWith(InstagramApiException e) {
		Outcome outcome = e.kind().deferrable() ? Outcome.DEFERRED : Outcome.FAILED;
		return new PublicationResult(outcome, Optional.empty(), Optional.of(e.reason()));
	}

	static PublicationResult failed(FailureReason reason) {
		return new PublicationResult(Outcome.FAILED, Optional.empty(), Optional.of(reason));
	}

	static PublicationResult stillProcessing() {
		return new PublicationResult(Outcome.STILL_PROCESSING, Optional.empty(), Optional.empty());
	}

	Outcome outcome() {
		return outcome;
	}

	PublishResult publishResult() {
		return published.orElseThrow();
	}

	FailureReason reason() {
		return reason.orElseThrow();
	}
}
