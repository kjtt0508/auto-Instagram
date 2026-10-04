package jp.co.keai.niijimaig.post.application;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import jp.co.keai.niijimaig.connection.domain.InstagramConnection;
import jp.co.keai.niijimaig.post.domain.AiDisclosure;
import jp.co.keai.niijimaig.post.domain.Caption;
import jp.co.keai.niijimaig.post.domain.PublishResult;

/**
 * Instagram への公開（Graph API の薄いクライアント。実装は infrastructure）。
 * 失敗は InstagramApiException（失敗区分つき）で知らせる。
 */
public interface InstagramPublisher {

	/** 24時間の公開数に余裕があるか */
	boolean hasPublishingQuota(InstagramConnection connection);

	/** AI生成の表示が要るなら AI info（is_ai_generated）を付ける（REQ-005 AC-005-11） */
	String createImageContainer(InstagramConnection connection, String imageUrl, Caption caption, AiDisclosure disclosure);

	String createCarouselItem(InstagramConnection connection, String imageUrl);

	/** カルーセルは親コンテナに AI info を付ける */
	String createCarouselContainer(InstagramConnection connection, List<String> childIds, Caption caption, AiDisclosure disclosure);

	ContainerState containerState(InstagramConnection connection, String containerId);

	/** 公開してメディアIDを返す */
	String publish(InstagramConnection connection, String containerId);

	PublishResult describe(InstagramConnection connection, String mediaId);

	/** 中断からの復旧用: since 以降に公開された、キャプションが一致するメディア */
	Optional<String> findPublishedMedia(InstagramConnection connection, Caption caption, Instant since);

	enum ContainerState {
		IN_PROGRESS, FINISHED, PUBLISHED, ERROR, EXPIRED;

		public boolean isTerminalFailure() {
			return this == ERROR || this == EXPIRED;
		}
	}
}
