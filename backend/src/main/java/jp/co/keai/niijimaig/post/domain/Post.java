package jp.co.keai.niijimaig.post.domain;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import jp.co.keai.niijimaig.post.domain.PostEvent.Kind;

/**
 * 投稿（定期処理から見た姿）: 承認された版の内容と、現在の状態・予約日時を持つ。
 * 公開に関する出来事だけを作る。状態を変えるたびに、出来事を適用した新しい投稿を返す。
 */
public final class Post {

	private final Identity identity;
	private final PostStatus status;
	private final ApprovedContent content;
	private final ScheduledAt scheduledAt;

	public Post(Identity identity, PostStatus status, ApprovedContent content, ScheduledAt scheduledAt) {
		if (identity == null || status == null || content == null || scheduledAt == null) {
			throw new IllegalArgumentException("投稿ID・状態・承認された内容・予約日時は必須");
		}
		this.identity = identity;
		this.status = status;
		this.content = content;
		this.scheduledAt = scheduledAt;
	}

	/** 定期処理がこの投稿に対して次に何をすべきか */
	public PublishingStep nextStep(Instant now, PublishGrace grace) {
		if (!status.awaitsPublishing()) {
			return new PublishingStep.Skip("予約中ではありません（" + status + "）");
		}
		if (status.isInterruptedPublishing()) {
			return new PublishingStep.Recover();
		}
		if (!scheduledAt.isDue(now)) {
			return new PublishingStep.Skip("予約日時になっていません");
		}
		if (!grace.allowsAutoPublish(scheduledAt, now)) {
			FailureReason reason = new FailureReason(FailureKind.GRACE_EXCEEDED, grace.exceededMessage());
			return new PublishingStep.Expire(failed(reason), reason);
		}
		return new PublishingStep.Start(PostEvent.of(Kind.PUBLISH_STARTED, status, PostStatus.PUBLISHING));
	}

	/** 公開してよい内容か。公開用キャプション（PR表記・AI生成の表示込み）と画像を検査し、理由を列挙する */
	public List<String> violationsForPublishing(PostMediaList prepared, ImageSpec spec, String prLabel) {
		List<String> violations = new ArrayList<>(content.media().violationsFor(content.format(), spec));
		if (prepared.count() != content.media().count()) {
			violations.add("公開用画像の枚数が承認された版と一致しません");
		}
		violations.addAll(content.revision().publishCaption(prLabel).violations());
		return List.copyOf(violations);
	}

	/** 公開用キャプション（PR案件ならPR表記、写真風の生成画像を含むならAI生成の表示付き。組み立ては PublishCaption）。上限を超えるなら例外 */
	public Caption publishCaption(String prLabel) {
		return content.revision().publishCaption(prLabel).toCaption();
	}

	/** Instagram の AI info（is_ai_generated）とキャプション末尾の定型文を付けるか */
	public AiDisclosure aiDisclosure() {
		return content.revision().aiDisclosure();
	}

	public PostEvent published() {
		return PostEvent.of(Kind.PUBLISHED, status, PostStatus.PUBLISHED);
	}

	public PostEvent failed(FailureReason reason) {
		return new PostEvent(Kind.FAILED, status, PostStatus.FAILED, reason.message());
	}

	/** 上限超過などで、予約中に戻して次の定期処理に回す */
	public PostEvent deferred(FailureReason reason) {
		return new PostEvent(Kind.PUBLISH_DEFERRED, status, PostStatus.SCHEDULED, reason.message());
	}

	/** 公開処理中のまま、定期処理が続きを試せなくなった: Instagram で公開済みか人に確認を頼む失敗にする */
	public Optional<PostEvent> abandonInterruptedPublishing(FailureReason reason) {
		if (!status.isInterruptedPublishing()) {
			return Optional.empty();
		}
		return Optional.of(failed(reason));
	}

	public Post apply(PostEvent event) {
		if (event.from() != status) {
			throw new IllegalStateException("投稿は " + status + " です（出来事は " + event.from() + " から）");
		}
		return new Post(identity, event.to(), content, scheduledAt);
	}

	public UUID id() {
		return identity.postId();
	}

	public UUID tenantId() {
		return identity.tenantId();
	}

	public UUID approvedRevisionId() {
		return content.revisionId();
	}

	public PostFormat format() {
		return content.format();
	}

	public PostMediaList approvedMedia() {
		return content.media();
	}

	/** 投稿IDと、投稿が属する団体 */
	public record Identity(UUID postId, UUID tenantId) {
		public Identity {
			if (postId == null || tenantId == null) {
				throw new IllegalArgumentException("投稿IDと団体IDは必須");
			}
		}
	}

	/** 承認された版の内容 */
	public record ApprovedContent(UUID revisionId, PostFormat format, PostRevision revision) {
		public ApprovedContent {
			if (revisionId == null || format == null || revision == null) {
				throw new IllegalArgumentException("承認された版の内容は必須");
			}
		}

		/** 写真をアップロードした投稿の内容 */
		public ApprovedContent(UUID revisionId, PostFormat format, Caption caption, PrCategory prCategory, PostMediaList media) {
			this(revisionId, format, PostRevision.ofPhotos(caption, prCategory, media));
		}

		/** 投稿画像一覧（テンプレートの投稿では空） */
		public PostMediaList media() {
			return revision.photos();
		}
	}

	/** 定期処理が次にすべきこと。Handler で受け取る（Java 17 のため switch のパターンマッチは使わない） */
	public sealed interface PublishingStep {

		void handle(Handler handler);

		interface Handler {
			void skip(String reason);
			void recover();
			void expire(PostEvent event, FailureReason reason);
			void start(PostEvent event);
		}

		record Skip(String reason) implements PublishingStep {
			public void handle(Handler handler) { handler.skip(reason); }
		}

		record Recover() implements PublishingStep {
			public void handle(Handler handler) { handler.recover(); }
		}

		record Expire(PostEvent event, FailureReason reason) implements PublishingStep {
			public void handle(Handler handler) { handler.expire(event, reason); }
		}

		record Start(PostEvent event) implements PublishingStep {
			public void handle(Handler handler) { handler.start(event); }
		}
	}
}
