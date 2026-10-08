package jp.co.keai.niijimaig.post.application;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.stereotype.Component;

import jp.co.keai.niijimaig.post.domain.PastPostCover;
import jp.co.keai.niijimaig.post.domain.Post;
import jp.co.keai.niijimaig.post.domain.PostMedia;
import jp.co.keai.niijimaig.post.domain.PostRevision;

/**
 * 準備のしかた「画像化」（REQ-002 設計 6章）: 承認の出来事ごとに、スライドを1枚ずつ 1080×1350 の JPEG にして
 * 非公開の保存先（renders/）と公開用の保存先に置き、記録する。記録済みの順番は作り直さない（再試行で冪等）。
 */
@Component
class TemplateRendering implements PreparationMethod {

	/** 画像化する1枚: 投稿・承認の出来事・順番 */
	private record Target(Post post, long approval, int position) {
		String renderPath() {
			return post.tenantId() + "/renders/" + approval + "/" + position + ".jpg";
		}
	}

	private final RenderRecords records;
	private final RenderStorage storage;
	private final TemplateRenderer renderer;
	private final MediaStorage media;

	TemplateRendering(RenderRecords records, RenderStorage storage, TemplateRenderer renderer, MediaStorage media) {
		this.records = records;
		this.storage = storage;
		this.renderer = renderer;
		this.media = media;
	}

	@Override
	public void prepare(Post post) {
		PostRevision revision = post.revision();
		long approval = records.latestApprovalEvent(post.id());
		List<PastPostCover> pastPosts = records.pastPosts(approval);
		Map<String, Object> shared = sharedData(post, pastPosts);
		List<Map<String, Object>> slides = revision.slideRenderValues(pastPosts);
		for (int i = 0; i < slides.size(); i++) {
			prepareSlide(new Target(post, approval, i + 1), slides.get(i), shared);
		}
	}

	/** 全スライドで共通の値: 投稿の型の設定と、画像（data URL） */
	private Map<String, Object> sharedData(Post post, List<PastPostCover> pastPosts) {
		List<String> refs = new ArrayList<>(post.revision().imageRefs());
		pastPosts.forEach(p -> refs.add(p.coverStoragePath()));
		Map<String, Object> shared = new LinkedHashMap<>();
		shared.put("settings", post.revision().settingsRenderValues());
		shared.put("images", new RenderImages(storage, post.tenantId()).dataUrls(refs));
		return shared;
	}

	private void prepareSlide(Target target, Map<String, Object> slide, Map<String, Object> shared) {
		UUID revisionId = target.post().approvedRevisionId();
		PostMedia rendered = records.rendered(target.approval(), target.position())
				.orElseGet(() -> renderAndRecord(target, slide, shared));
		if (records.publishMedia(revisionId, target.approval(), target.position()).isPresent()) {
			return;
		}
		String publicPath = media.copyToPublic(target.post().tenantId(), rendered.storagePath());
		records.recordPublishMedia(revisionId, target.approval(), rendered.copiedTo(publicPath));
	}

	private PostMedia renderAndRecord(Target target, Map<String, Object> slide, Map<String, Object> shared) {
		Map<String, Object> data = new LinkedHashMap<>(shared);
		data.put("slide", slide);
		String version = target.post().revision().templateVersion().orElseThrow();
		byte[] jpeg = renderer.render(version, data);
		PostMedia rendered = RenderedJpegs.checked(target.position(), target.renderPath(), jpeg);
		save(target.post().tenantId(), rendered.storagePath(), jpeg);
		records.recordRender(target.approval(), rendered);
		return rendered;
	}

	private void save(UUID tenantId, String path, byte[] jpeg) {
		try {
			storage.save(tenantId, OwnedStoragePath.require(tenantId, path), jpeg);
		} catch (RuntimeException e) {
			throw new RenderFailedException("画像化した画像を保存できません", e);
		}
	}
}
