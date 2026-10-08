package jp.co.keai.niijimaig.post.infrastructure;

import java.util.Map;
import java.util.Optional;
import java.util.function.Consumer;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import com.microsoft.playwright.Browser;
import com.microsoft.playwright.BrowserContext;
import com.microsoft.playwright.Page;
import com.microsoft.playwright.Playwright;
import com.microsoft.playwright.PlaywrightException;
import com.microsoft.playwright.Route;
import com.microsoft.playwright.options.ScreenshotType;
import com.microsoft.playwright.options.ServiceWorkerPolicy;

import jakarta.annotation.PreDestroy;
import jp.co.keai.niijimaig.post.application.RenderBrowserUnavailableException;
import jp.co.keai.niijimaig.post.application.RenderFailedException;
import jp.co.keai.niijimaig.post.application.TemplateRenderer;

/**
 * テンプレートを Playwright の chromium で描く（ADR-0010）。ブラウザは使うときに1回だけ起動し、終了時に閉じる。
 * 架空の origin（https://template.local/&lt;版&gt;/）にテンプレートのファイルを配り、それ以外の通信はすべて遮断する。
 */
@Component
class PlaywrightTemplateRenderer implements TemplateRenderer {

	static final String ORIGIN = "https://template.local";
	static final int WIDTH = 1080;
	static final int HEIGHT = 1350;
	static final String SKIP_DOWNLOAD = "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD";
	private static final double TIMEOUT_MS = 30_000;
	private static final Logger LOG = LoggerFactory.getLogger(PlaywrightTemplateRenderer.class);

	private final TemplateFiles files = new TemplateFiles();
	private Playwright playwright;
	private Browser browser;

	@Override
	public byte[] render(String templateVersion, Map<String, Object> data) {
		return render(templateVersion, data, page -> { });
	}

	/** 描き終えたページ（撮影の直前）を inspector に見せる。テストが DOM と通信の遮断を確かめるために使う */
	synchronized byte[] render(String templateVersion, Map<String, Object> data, Consumer<Page> inspector) {
		Browser started = browser();
		try (BrowserContext context = started.newContext(new Browser.NewContextOptions()
				.setViewportSize(WIDTH, HEIGHT).setDeviceScaleFactor(1).setServiceWorkers(ServiceWorkerPolicy.BLOCK))) {
			context.route("**/*", route -> serve(route, templateVersion));
			Page page = context.newPage();
			page.setDefaultTimeout(TIMEOUT_MS);
			page.navigate(ORIGIN + "/" + templateVersion + "/index.html");
			page.evaluate("data => window.render(data)", data);
			inspector.accept(page);
			return page.screenshot(new Page.ScreenshotOptions().setType(ScreenshotType.JPEG).setQuality(90));
		} catch (PlaywrightException e) {
			if (!started.isConnected()) {
				// ブラウザが落ちた・切断された: 内容のせいではないので、一時的な失敗（ジョブの再試行）として扱う
				LOG.warn("画像化のブラウザが切断されました: {}", e.getClass().getSimpleName());
				close();
				throw new RenderBrowserUnavailableException(e);
			}
			LOG.warn("画像化の描画に失敗: {}", e.getClass().getSimpleName());
			throw new RenderFailedException("テンプレートの描画に失敗しました", e);
		}
	}

	private void serve(Route route, String templateVersion) {
		String url = route.request().url();
		String prefix = ORIGIN + "/" + templateVersion + "/";
		Optional<byte[]> body = url.startsWith(prefix) ? files.read(templateVersion, pathOf(url.substring(prefix.length()))) : Optional.empty();
		if (body.isEmpty()) {
			route.abort();
			return;
		}
		route.fulfill(new Route.FulfillOptions().setStatus(200).setContentType(TemplateFiles.contentType(url))
				.setBodyBytes(body.get()));
	}

	/** クエリ・フラグメントを除いたパス */
	private static String pathOf(String rest) {
		int cut = rest.indexOf('?') >= 0 ? rest.indexOf('?') : rest.indexOf('#') >= 0 ? rest.indexOf('#') : rest.length();
		return rest.substring(0, cut);
	}

	private Browser browser() {
		if (browser != null && browser.isConnected()) {
			return browser;
		}
		close();
		try {
			// ブラウザの自動ダウンロードはしない（実行のたびに3種類を落とさない）。使うのは chromium だけで、無ければ起動に失敗する
			playwright = Playwright.create(new Playwright.CreateOptions().setEnv(Map.of(SKIP_DOWNLOAD, "1")));
			browser = playwright.chromium().launch();
			return browser;
		} catch (RuntimeException e) {
			close();
			LOG.warn("画像化のブラウザを起動できません: {}", e.getClass().getSimpleName());
			throw new RenderBrowserUnavailableException(e);
		}
	}

	@PreDestroy
	synchronized void close() {
		closeQuietly(browser == null ? null : browser::close);
		closeQuietly(playwright == null ? null : playwright::close);
		browser = null;
		playwright = null;
	}

	private static void closeQuietly(Runnable closing) {
		if (closing == null) {
			return;
		}
		try {
			closing.run();
		} catch (RuntimeException e) {
			LOG.debug("閉じるときのエラーは無視する: {}", e.getClass().getSimpleName());
		}
	}
}
