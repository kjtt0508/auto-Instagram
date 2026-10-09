package jp.co.keai.niijimaig.post.application;

/**
 * 画像化の一時的な失敗（ブラウザを起動できない・Storage の 5xx や接続失敗・記録の失敗・tick の持ち時間切れ）。内容のせいではないので、
 * ジョブを次の tick で再試行する（最大3回。3回目も失敗したら画像化の失敗にする）。内容による失敗は RenderFailedException。
 * 持ち時間切れ（TIME_BUDGET）は、この試行で1枚でも進んでいれば試行回数に数えない（Job.deferred）
 */
public class RenderTemporaryFailureException extends RuntimeException {

	static final String TIME_BUDGET = "TIME_BUDGET";

	private final String code;
	private final boolean progressed;

	public RenderTemporaryFailureException(String code, String detail, Throwable cause) {
		this(code, detail, cause, false);
	}

	private RenderTemporaryFailureException(String code, String detail, Throwable cause, boolean progressed) {
		super(detail, cause);
		this.code = code;
		this.progressed = progressed;
	}

	/** tick の持ち時間が尽きた。progressed はこの試行で1枚でも準備できたか */
	static RenderTemporaryFailureException timeBudget(boolean progressed) {
		return new RenderTemporaryFailureException(TIME_BUDGET, "tick の持ち時間が足りないので、次の定期処理で続きを描きます", null, progressed);
	}

	/** ジョブの試行記録に残す短い区分（本文・秘密情報を含まない） */
	public String code() {
		return code;
	}

	boolean isTimeBudget() {
		return TIME_BUDGET.equals(code);
	}

	/** 持ち時間切れで、かつこの試行で進んだ（次に回しても同じところで止まらない） */
	boolean deferrable() {
		return isTimeBudget() && progressed;
	}
}
