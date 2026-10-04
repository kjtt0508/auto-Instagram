package jp.co.keai.niijimaig.post.domain;

/** 失敗区分: 失敗の種類。同じ試行内で自動リトライしてよいかと、次の定期処理に回すかが変わる */
public enum FailureKind {
	TRANSIENT(true, false, "一時的なエラーです。再実行してください"),
	RATE_LIMITED(false, true, "Instagramの投稿数の上限に達しています。時間を置いて自動で再試行します"),
	TOKEN_INVALID(false, false, "Instagram連携が切れています。設定画面から連携をやり直してください"),
	MEDIA_REJECTED(false, false, "画像や内容に不備があります。下書きに戻して直してください"),
	GRACE_EXCEEDED(false, false, "公開予定から時間が経ちすぎました。日時を決めて再実行してください"),
	/** テンプレートの投稿の画像化に失敗（画像が無い・ブラウザの失敗・保存の失敗）。自動リトライも延期もせず、「今すぐ再実行」でやり直す */
	RENDER_FAILED(false, false, "画像化に失敗しました。今すぐ再実行でやり直せます"),
	UNKNOWN(false, false, "原因が分かりません。Instagramで公開されていないか確認してから再実行してください");

	private final boolean retryableInSameAttempt;
	private final boolean deferrable;
	private final String guidance;

	FailureKind(boolean retryableInSameAttempt, boolean deferrable, String guidance) {
		this.retryableInSameAttempt = retryableInSameAttempt;
		this.deferrable = deferrable;
		this.guidance = guidance;
	}

	public boolean retryableInSameAttempt() {
		return retryableInSameAttempt;
	}

	/** 失敗にせず、予約中に戻して次の定期処理に回すか（公開延期） */
	public boolean deferrable() {
		return deferrable;
	}

	public String guidance() {
		return guidance;
	}
}
