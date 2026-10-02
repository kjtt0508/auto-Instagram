package jp.co.keai.niijimaig.post.domain;

/**
 * 投稿履歴: 投稿に起きた出来事。追記のみ。出来事の種類ごとに許される遷移が決まっている（DB post_status_transitions）。
 * 定期処理が記録するのは公開系の出来事だけ。
 */
public record PostEvent(Kind kind, PostStatus from, PostStatus to, String note) {

	public enum Kind {
		CREATED, APPROVAL_REQUESTED, APPROVED, REVISION_REQUESTED, SCHEDULE_CANCELLED,
		PUBLISH_STARTED, PUBLISH_DEFERRED, PUBLISHED, FAILED, RETRIED, RETURNED_TO_DRAFT, DISCARDED
	}

	public PostEvent {
		if (kind == null || from == null || to == null) {
			throw new IllegalArgumentException("出来事の種類と遷移は必須");
		}
		from.transitTo(to);
		note = note == null ? "" : note;
	}

	static PostEvent of(Kind kind, PostStatus from, PostStatus to) {
		return new PostEvent(kind, from, to, "");
	}

	public boolean hasNote() {
		return !note.isEmpty();
	}
}
