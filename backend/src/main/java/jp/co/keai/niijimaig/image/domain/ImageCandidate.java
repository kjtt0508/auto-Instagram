package jp.co.keai.niijimaig.image.domain;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

/**
 * 候補: 画像生成で作られ、まだ採用されていない画像。採用されなければ残さない（REQ-005 BR-005-11）。
 * どの団体の、どの画像生成の何番目（1〜4）かと、画像生成の日時を持つ
 */
public record ImageCandidate(UUID tenantId, UUID generationId, int position, Instant generatedAt) {

	/** 画像生成からこの時間を過ぎた候補は、片付けられていなくても放置とみなして消してよい（選んでいる最中の候補は消さない） */
	public static final Duration ABANDONED_AFTER = Duration.ofHours(24);
	static final int MAX_POSITION = 4;

	public ImageCandidate {
		if (tenantId == null || generationId == null || generatedAt == null) {
			throw new IllegalArgumentException("団体・画像生成ID・画像生成の日時は必須");
		}
		if (position < 1 || position > MAX_POSITION) {
			throw new IllegalArgumentException("候補の位置は1〜" + MAX_POSITION + ": " + position);
		}
	}

	/** 放置されたか（画像生成から24時間を過ぎた。AC-005-13） */
	public boolean isAbandoned(Instant now) {
		return now.isAfter(generatedAt.plus(ABANDONED_AFTER));
	}
}
