package jp.co.keai.niijimaig.post.application;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

import jp.co.keai.niijimaig.connection.domain.InstagramConnection;
import jp.co.keai.niijimaig.post.application.InstagramPublisher.ContainerState;
import jp.co.keai.niijimaig.post.application.PublishingLog.ContainerKind;
import jp.co.keai.niijimaig.post.domain.Caption;
import jp.co.keai.niijimaig.post.domain.FailureKind;
import jp.co.keai.niijimaig.post.domain.FailureReason;
import jp.co.keai.niijimaig.post.domain.Post;

/**
 * Instagram 側の手順: コンテナ作成 → 処理状態の確認 → 公開 → 結果取得（02_外部連携設計 1.3）。
 * コンテナは作るたびに記録し、中断したときは状態を確かめてから続きを行う（二重公開しない）。
 */
final class InstagramPublication {

	static final Duration POLL_INTERVAL = Duration.ofSeconds(5);
	static final int MAX_POLLS = 12;

	private final InstagramPublisher instagram;
	private final PublishingLog log;
	private final InAttemptRetry retry;

	InstagramPublication(InstagramPublisher instagram, PublishingLog log, InAttemptRetry retry) {
		this.instagram = instagram;
		this.log = log;
		this.retry = retry;
	}

	PublicationResult publishNew(Target target) {
		try {
			if (!retry.call(() -> instagram.hasPublishingQuota(target.connection()))) {
				throw new InstagramApiException(FailureKind.RATE_LIMITED, "24時間の公開数の上限");
			}
			return finish(target, createContainers(target));
		} catch (InstagramApiException e) {
			return PublicationResult.failedWith(e);
		}
	}

	/** 公開処理中のまま中断した投稿の続き */
	PublicationResult recover(Target target) {
		Optional<String> parent = log.lastParentContainer(target.post().id());
		if (parent.isEmpty()) {
			return publishNew(target);
		}
		try {
			ContainerState state = retry.call(() -> instagram.containerState(target.connection(), parent.get()));
			return continueFrom(target, parent.get(), state);
		} catch (InstagramApiException e) {
			return PublicationResult.failedWith(e);
		}
	}

	private PublicationResult continueFrom(Target target, String parent, ContainerState state) {
		if (state == ContainerState.PUBLISHED) {
			return findAlreadyPublished(target);
		}
		if (state.isTerminalFailure()) {
			return publishNew(target);
		}
		return finish(target, parent);
	}

	private PublicationResult findAlreadyPublished(Target target) {
		Instant since = log.publishingStartedAt(target.post().id()).orElse(Instant.EPOCH);
		return instagram.findPublishedMedia(target.connection(), target.caption(), since)
				.map(mediaId -> PublicationResult.published(instagram.describe(target.connection(), mediaId)))
				.orElseGet(() -> PublicationResult.failed(FailureReason.of(FailureKind.UNKNOWN)));
	}

	private String createContainers(Target target) {
		InstagramConnection connection = target.connection();
		if (!target.post().format().needsChildContainers()) {
			String single = retry.call(() -> instagram.createImageContainer(connection, target.imageUrls().get(0), target.caption()));
			log.recordContainer(target.post().id(), target.attemptId(), ContainerKind.SINGLE, single);
			return single;
		}
		List<String> children = target.imageUrls().stream().map(url -> createChild(target, url)).toList();
		String carousel = retry.call(() -> instagram.createCarouselContainer(connection, children, target.caption()));
		log.recordContainer(target.post().id(), target.attemptId(), ContainerKind.CAROUSEL, carousel);
		return carousel;
	}

	private String createChild(Target target, String url) {
		String child = retry.call(() -> instagram.createCarouselItem(target.connection(), url));
		log.recordContainer(target.post().id(), target.attemptId(), ContainerKind.CHILD, child);
		return child;
	}

	/** 処理が終わるのを待ってから公開する。待ちきれなければ次の定期処理で続ける */
	private PublicationResult finish(Target target, String container) {
		ContainerState state = waitUntilProcessed(target.connection(), container);
		if (state.isTerminalFailure()) {
			return PublicationResult.failed(FailureReason.of(FailureKind.MEDIA_REJECTED));
		}
		if (state == ContainerState.IN_PROGRESS) {
			return PublicationResult.stillProcessing();
		}
		String mediaId = retry.call(() -> instagram.publish(target.connection(), container));
		return PublicationResult.published(retry.call(() -> instagram.describe(target.connection(), mediaId)));
	}

	private ContainerState waitUntilProcessed(InstagramConnection connection, String container) {
		ContainerState state = ContainerState.IN_PROGRESS;
		for (int i = 0; i < MAX_POLLS && state == ContainerState.IN_PROGRESS; i++) {
			state = retry.call(() -> instagram.containerState(connection, container));
			if (state == ContainerState.IN_PROGRESS) {
				retry.sleeper().sleep(POLL_INTERVAL);
			}
		}
		return state;
	}

	/** 1件の公開に必要なもの */
	record Target(Post post, InstagramConnection connection, Caption caption, List<String> imageUrls, long attemptId) {
	}
}
