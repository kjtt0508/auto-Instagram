package jp.co.keai.niijimaig.post.application;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/** 公開の途中経過の記録（Instagram に作ったコンテナ）。中断からの復旧に使う */
public interface PublishingLog {

	void recordContainer(UUID postId, long attemptId, ContainerKind kind, String containerId);

	/** 最後に作った親コンテナ（画像1枚なら SINGLE、カルーセルなら CAROUSEL） */
	Optional<String> lastParentContainer(UUID postId);

	/** 最後に公開を始めた時刻 */
	Optional<Instant> publishingStartedAt(UUID postId);

	enum ContainerKind {
		SINGLE, CHILD, CAROUSEL
	}
}
