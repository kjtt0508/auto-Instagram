package jp.co.keai.niijimaig.post.domain;

import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

/** 投稿状態。投稿履歴から導出する（domain.yaml 投稿状態 / DB post_status_transitions と一致させる） */
public enum PostStatus {
	DRAFT, AWAITING_APPROVAL, SCHEDULED, PUBLISHING, PUBLISHED, FAILED, DISCARDED;

	private static final Map<PostStatus, Set<PostStatus>> ALLOWED = Map.of(
			DRAFT, EnumSet.of(AWAITING_APPROVAL, DISCARDED),
			AWAITING_APPROVAL, EnumSet.of(SCHEDULED, DRAFT, DISCARDED),
			SCHEDULED, EnumSet.of(PUBLISHING, DRAFT, FAILED),
			PUBLISHING, EnumSet.of(PUBLISHED, FAILED, SCHEDULED),
			PUBLISHED, EnumSet.noneOf(PostStatus.class),
			FAILED, EnumSet.of(SCHEDULED, DRAFT, DISCARDED),
			DISCARDED, EnumSet.noneOf(PostStatus.class));

	public boolean canTransitTo(PostStatus next) {
		return ALLOWED.get(this).contains(next);
	}

	public PostStatus transitTo(PostStatus next) {
		if (!canTransitTo(next)) {
			throw new IllegalStateException(this + " から " + next + " へは遷移できない");
		}
		return next;
	}

	public boolean isEditable() {
		return this == DRAFT;
	}

	/** 定期処理が公開に取りかかってよい状態か（予約中、または前回の公開が中断した） */
	public boolean awaitsPublishing() {
		return this == SCHEDULED || this == PUBLISHING;
	}

	public boolean isInterruptedPublishing() {
		return this == PUBLISHING;
	}
}
