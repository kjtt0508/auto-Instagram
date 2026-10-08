package jp.co.keai.niijimaig.post.application;

/**
 * 画像化の一時的な失敗（ブラウザを起動できない・Storage の 5xx や接続失敗・記録の失敗）。内容のせいではないので、
 * ジョブを次の tick で再試行する（最大3回。3回目も失敗したら画像化の失敗にする）。内容による失敗は RenderFailedException
 */
public class RenderTemporaryFailureException extends RuntimeException {

	private final String code;

	public RenderTemporaryFailureException(String code, String detail, Throwable cause) {
		super(detail, cause);
		this.code = code;
	}

	/** ジョブの試行記録に残す短い区分（本文・秘密情報を含まない） */
	public String code() {
		return code;
	}
}
