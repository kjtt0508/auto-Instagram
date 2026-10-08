package jp.co.keai.niijimaig.post.application;

/** 画像化のブラウザ（Playwright の chromium）を起動できない・描画中に切断された。一時的な失敗として、ジョブを次の tick で再試行する */
public class RenderBrowserUnavailableException extends RenderTemporaryFailureException {

	public RenderBrowserUnavailableException(Throwable cause) {
		super("BROWSER_UNAVAILABLE", "画像化のブラウザを起動できません", cause);
	}
}
