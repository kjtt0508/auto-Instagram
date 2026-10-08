package jp.co.keai.niijimaig.post.application;

import java.util.Map;

/**
 * テンプレートを描いて JPEG にする（実装は infrastructure の Playwright）。
 * data はテンプレートの render(data) に渡す値（slide・settings・images）。
 */
public interface TemplateRenderer {

	/**
	 * スライド1枚を 1080×1350 の JPEG にする。
	 *
	 * @throws RenderBrowserUnavailableException ブラウザを起動できない（一時的な失敗。ジョブを再試行する）
	 * @throws RenderFailedException 描画に失敗した（やり直しても同じ）
	 */
	byte[] render(String templateVersion, Map<String, Object> data);
}
