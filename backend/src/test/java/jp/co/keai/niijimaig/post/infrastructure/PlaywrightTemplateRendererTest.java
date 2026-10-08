package jp.co.keai.niijimaig.post.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;

import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import javax.imageio.ImageIO;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import com.microsoft.playwright.Page;
import com.microsoft.playwright.PlaywrightException;

import jp.co.keai.niijimaig.post.domain.BodyContent;
import jp.co.keai.niijimaig.post.domain.Caption;
import jp.co.keai.niijimaig.post.domain.CaptionFooter;
import jp.co.keai.niijimaig.post.domain.ClosingContent;
import jp.co.keai.niijimaig.post.domain.CoverContent;
import jp.co.keai.niijimaig.post.domain.CoverText;
import jp.co.keai.niijimaig.post.domain.FixedHashtags;
import jp.co.keai.niijimaig.post.domain.PostRevision;
import jp.co.keai.niijimaig.post.domain.PostStyleSettings;
import jp.co.keai.niijimaig.post.domain.PrCategory;
import jp.co.keai.niijimaig.post.domain.RevisionContent.RenderPlan;
import jp.co.keai.niijimaig.post.domain.Slide;
import jp.co.keai.niijimaig.post.domain.SlideList;
import jp.co.keai.niijimaig.post.domain.SlideText;
import jp.co.keai.niijimaig.support.ChromiumInstaller;

/** 実物の chromium でテンプレートを描く（REQ-002 設計 6・7章）: HTML が文字として出ること、template.local 以外への通信が遮断されること */
class PlaywrightTemplateRendererTest {

	static final String VERSION = "niijima@1";
	static PlaywrightTemplateRenderer renderer;

	@BeforeAll
	static void startBrowser() {
		ChromiumInstaller.ensureInstalled();
		renderer = new PlaywrightTemplateRenderer();
	}

	@AfterAll
	static void stopBrowser() {
		renderer.close();
	}

	/** 画像の無い表紙・中のスライド・最後のスライドの計画 */
	private static RenderPlan plan(String keyword, String heading) {
		PostStyleSettings settings = new PostStyleSettings(UUID.randomUUID(), 1, "新島info", List.of("同志社大学"), "ありがとうございます",
				"@niijima_info", new CaptionFooter("定型の文面"), new FixedHashtags(List.of("#固定")), Optional.empty());
		List<Slide> slides = new ArrayList<>();
		slides.add(new Slide(new CoverContent(CoverText.restore(new CoverText.Parts("同志社大学", keyword, "", "まとめたよ", "RED")), Optional.empty())));
		slides.add(new Slide(new BodyContent(SlideText.restore(heading, "学生証を見せるだけで割引になります", List.of("学生証")), Optional.empty())));
		slides.add(new Slide(ClosingContent.empty()));
		return PostRevision.ofSlides(new Caption("本文"), PrCategory.NONE, SlideList.of(slides), VERSION, settings, List.of())
				.renderPlan(List.of()).orElseThrow();
	}

	private static Map<String, Object> data(RenderPlan plan, int index) {
		Map<String, Object> data = new LinkedHashMap<>();
		data.put("slide", plan.slides().get(index).values());
		data.put("settings", plan.settings());
		data.put("images", Map.of());
		return data;
	}

	@Test
	@DisplayName("AC-002-02 3つのスライドを 1080×1350 の JPEG にする")
	void rendersJpegOf1080x1350() throws IOException {
		RenderPlan plan = plan("期末試験", "学割が使える");
		for (int i = 0; i < 3; i++) {
			BufferedImage image = ImageIO.read(new ByteArrayInputStream(renderer.render(VERSION, data(plan, i))));
			assertThat(image.getWidth()).isEqualTo(1080);
			assertThat(image.getHeight()).isEqualTo(1350);
		}
	}

	@Test
	@DisplayName("AC-002-01 差し込む文言に含まれる <script> や <img onerror> は、実行されず文字として表示される")
	void htmlInTextIsShownAsText() {
		String script = "<script>window.__pwned=1</script>";
		String image = "<img src=x onerror=\"window.__pwned=2\">";
		RenderPlan plan = plan(script, image);
		AtomicReference<String> coverText = new AtomicReference<>();
		AtomicReference<Object> coverPwned = new AtomicReference<>();
		AtomicReference<Object> coverExtraScripts = new AtomicReference<>();
		AtomicReference<String> bodyText = new AtomicReference<>();
		AtomicReference<Object> bodyPwned = new AtomicReference<>();
		AtomicReference<Object> bodyExtraImages = new AtomicReference<>();

		renderer.render(VERSION, data(plan, 0), page -> {
			coverText.set((String) page.evaluate("() => document.body.innerText"));
			coverPwned.set(page.evaluate("() => typeof window.__pwned"));
			coverExtraScripts.set(page.evaluate("() => document.querySelectorAll('script').length"));
		});
		renderer.render(VERSION, data(plan, 1), page -> {
			bodyText.set((String) page.evaluate("() => document.body.innerText"));
			bodyPwned.set(page.evaluate("() => typeof window.__pwned"));
			bodyExtraImages.set(page.evaluate("() => document.querySelectorAll('img[onerror]').length"));
		});

		assertThat(coverText.get()).contains(script);
		assertThat(coverPwned.get()).isEqualTo("undefined");
		assertThat(coverExtraScripts.get()).isEqualTo(1);
		assertThat(bodyText.get()).contains(image);
		assertThat(bodyPwned.get()).isEqualTo("undefined");
		assertThat(bodyExtraImages.get()).isEqualTo(0);
	}

	@Test
	@DisplayName("AC-002-01 template.local の版の中のファイル以外への通信は遮断される（外部・別の版・版の外）")
	void everythingButTheTemplateFilesIsBlocked() {
		AtomicReference<Map<String, Boolean>> reached = new AtomicReference<>();

		renderer.render(VERSION, data(plan("期末試験", "学割が使える"), 0), page -> {
			Map<String, Boolean> results = new LinkedHashMap<>();
			// 描画に使ったページと同じ文脈の別のページから、直接移動してみる（テンプレートの CSP とは別に、通信の経路そのものを確かめる）
			Page probe = page.context().newPage();
			for (String url : List.of("https://example.com/", "http://example.com/", "https://template.local/other@1/index.html",
					"https://template.local/niijima@1/../other@1/index.html", "https://template.local/niijima@1/no-such.js",
					"https://template.local/index.html")) {
				results.put(url, navigates(probe, url));
			}
			results.put("https://template.local/niijima@1/index.html", navigates(page.context().newPage(), "https://template.local/niijima@1/index.html"));
			reached.set(results);
		});

		Map<String, Boolean> results = reached.get();
		assertThat(results.get("https://template.local/niijima@1/index.html")).isTrue();
		results.remove("https://template.local/niijima@1/index.html");
		assertThat(results.values()).containsOnly(false);
	}

	private static boolean navigates(Page page, String url) {
		try {
			return page.navigate(url) != null;
		} catch (PlaywrightException e) {
			return false;
		}
	}
}
