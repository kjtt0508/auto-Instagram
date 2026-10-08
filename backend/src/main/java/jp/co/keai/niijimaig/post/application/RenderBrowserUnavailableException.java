package jp.co.keai.niijimaig.post.application;

/** 画像化のブラウザ（Playwright の chromium）を起動できない。一時的な失敗として、ジョブを次の tick で再試行する */
public class RenderBrowserUnavailableException extends RuntimeException {

	public RenderBrowserUnavailableException(Throwable cause) {
		super("画像化のブラウザを起動できません", cause);
	}
}
