package jp.co.keai.niijimaig.post.application;

import java.time.Clock;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;

import org.springframework.stereotype.Component;

import jp.co.keai.niijimaig.post.domain.PastPostCover;
import jp.co.keai.niijimaig.post.domain.Post;
import jp.co.keai.niijimaig.post.domain.PostMedia;
import jp.co.keai.niijimaig.post.domain.RevisionContent.RenderPlan;

/**
 * 準備のしかた「画像化」（REQ-002 設計 6章）: 承認の出来事ごとに、スライドを1枚ずつ 1080×1350 の JPEG にして
 * 非公開の保存先（renders/）と公開用の保存先に置き、記録する。記録済みの順番は作り直さない（再試行で冪等）。
 * 失敗は2つに分ける。内容による失敗（画像が無い・描画の失敗・画像の仕様違反）は RenderFailedException（やり直しても同じ）、
 * 外部の都合による失敗（ブラウザ・Storage の 5xx や接続失敗・記録の失敗）は RenderTemporaryFailureException（ジョブの再試行）。
 */
@Component
class TemplateRendering implements PreparationMethod {

	/** 画像化する1枚: 投稿・承認の出来事・順番 */
	private record Target(Post post, long approval, int position) {
		String renderPath() {
			return post.tenantId() + "/renders/" + approval + "/" + position + ".jpg";
		}

		/** 公開用の保存先の名前を決める鍵（承認と順番から決まるので、再試行で同じ保存先になる） */
		String publicKey() {
			return "render/" + approval + "/" + position;
		}
	}

	private final RenderRecords records;
	private final RenderStorage storage;
	private final TemplateRenderer renderer;
	private final MediaStorage media;
	private final Clock clock;

	TemplateRendering(RenderRecords records, RenderStorage storage, TemplateRenderer renderer, MediaStorage media, Clock clock) {
		this.records = records;
		this.storage = storage;
		this.renderer = renderer;
		this.media = media;
		this.clock = clock;
	}

	@Override
	public void prepare(Post post, Instant deadline) {
		UUID revisionId = post.approvedRevisionId();
		long approval = guarded("RECORD_UNAVAILABLE", () -> records.approvalEvent(post.id(), revisionId));
		List<PastPostCover> pastPosts = guarded("RECORD_UNAVAILABLE", () -> records.pastPosts(approval));
		RenderPlan plan = post.revision().renderPlan(pastPosts)
				.orElseThrow(() -> new IllegalStateException("画像化できない投稿の版です"));
		List<RenderPlan.SlideRender> slides = plan.slides();
		for (int i = 0; i < slides.size(); i++) {
			prepareSlide(new Target(post, approval, i + 1), plan, slides.get(i), deadline);
		}
	}

	private void prepareSlide(Target target, RenderPlan plan, RenderPlan.SlideRender slide, Instant deadline) {
		UUID revisionId = target.post().approvedRevisionId();
		if (guarded("RECORD_UNAVAILABLE", () -> records.publishMedia(revisionId, target.approval(), target.position())).isPresent()) {
			return;
		}
		PostMedia rendered = guarded("RECORD_UNAVAILABLE", () -> records.rendered(target.approval(), target.position()))
				.orElseGet(() -> renderBeforeDeadline(target, plan, slide, deadline));
		String publicPath = guarded("STORAGE_UNAVAILABLE",
				() -> media.copyToPublic(target.post().tenantId(), rendered.storagePath(), target.publicKey()));
		guarded("RECORD_UNAVAILABLE", () -> {
			records.recordPublishMedia(revisionId, target.approval(), rendered.copiedTo(publicPath));
			return null;
		});
	}

	/** 描く前に残り時間を確かめる。足りなければ一時的な失敗（描けた分は記録済みなので、次の tick で続きから） */
	private PostMedia renderBeforeDeadline(Target target, RenderPlan plan, RenderPlan.SlideRender slide, Instant deadline) {
		if (!clock.instant().isBefore(deadline)) {
			throw new RenderTemporaryFailureException("TIME_BUDGET", "tick の持ち時間が足りないので、次の定期処理で続きを描きます", null);
		}
		return renderAndRecord(target, plan, slide);
	}

	private PostMedia renderAndRecord(Target target, RenderPlan plan, RenderPlan.SlideRender slide) {
		UUID tenantId = target.post().tenantId();
		Map<String, Object> data = new LinkedHashMap<>();
		data.put("slide", slide.values());
		data.put("settings", plan.settings());
		// このスライドが使う画像だけを渡す（全スライドぶんを毎回渡さない）
		data.put("images", new RenderImages(storage, tenantId).dataUrls(slide.imageRefs()));
		byte[] jpeg = renderer.render(plan.templateVersion(), data);
		PostMedia rendered = RenderedJpegs.checked(target.position(), target.renderPath(), jpeg);
		String path = OwnedStoragePath.require(tenantId, rendered.storagePath());
		guarded("STORAGE_UNAVAILABLE", () -> {
			storage.save(tenantId, path, jpeg);
			return null;
		});
		guarded("RECORD_UNAVAILABLE", () -> {
			records.recordRender(target.post().approvedRevisionId(), target.approval(), rendered);
			return null;
		});
		return rendered;
	}

	/** 外部（Storage・DB）の呼び出し。画像化の失敗・一時的な失敗として分類済みの例外はそのまま、それ以外の例外は一時的な失敗にする */
	static <T> T guarded(String code, Supplier<T> call) {
		try {
			return call.get();
		} catch (RenderFailedException | RenderTemporaryFailureException e) {
			throw e;
		} catch (RuntimeException e) {
			throw new RenderTemporaryFailureException(code, "外部の呼び出しに失敗しました（" + e.getClass().getSimpleName() + "）", e);
		}
	}
}
