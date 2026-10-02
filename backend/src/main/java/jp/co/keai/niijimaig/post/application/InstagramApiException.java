package jp.co.keai.niijimaig.post.application;

import jp.co.keai.niijimaig.post.domain.FailureKind;
import jp.co.keai.niijimaig.post.domain.FailureReason;

/** Instagram API の失敗。失敗区分で、リトライ・延期・失敗のどれにするかが決まる */
public class InstagramApiException extends RuntimeException {

	private final FailureKind kind;

	public InstagramApiException(FailureKind kind, String message) {
		super(message);
		this.kind = kind;
	}

	public FailureKind kind() {
		return kind;
	}

	/** 画面に出す失敗理由（API の生の応答は出さず、区分ごとの対処を出す） */
	public FailureReason reason() {
		return FailureReason.of(kind);
	}
}
