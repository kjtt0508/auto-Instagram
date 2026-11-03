package jp.co.keai.niijimaig.post.domain;

/** 失敗理由: 失敗区分と、人が読める説明 */
public final class FailureReason {

	static final int MAX_LENGTH = 500;

	private final FailureKind kind;
	private final String message;

	public FailureReason(FailureKind kind, String message) {
		if (kind == null || message == null || message.isBlank()) {
			throw new IllegalArgumentException("失敗区分と説明は必須");
		}
		this.kind = kind;
		this.message = message.length() > MAX_LENGTH ? message.substring(0, MAX_LENGTH) : message;
	}

	public static FailureReason of(FailureKind kind) {
		return new FailureReason(kind, kind.guidance());
	}

	/**
	 * 画像化の失敗の説明を作る: 「今すぐ再実行」で直る失敗は、失敗区分の対処方法＋詳細（対処方法（詳細））。
	 * 直らない失敗（最後のスライドの画像が見つからない。REQ-007 BR-007-06）は、再実行の案内を付けず詳細だけ
	 */
	public static FailureReason renderFailed(String detail, boolean fixableByRerun) {
		String message = fixableByRerun ? FailureKind.RENDER_FAILED.guidance() + "（" + detail + "）" : detail;
		return new FailureReason(FailureKind.RENDER_FAILED, message);
	}

	public FailureKind kind() {
		return kind;
	}

	public String message() {
		return message;
	}
}
