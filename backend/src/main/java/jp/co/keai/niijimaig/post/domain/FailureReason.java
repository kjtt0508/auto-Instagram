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

	public FailureKind kind() {
		return kind;
	}

	public String message() {
		return message;
	}
}
