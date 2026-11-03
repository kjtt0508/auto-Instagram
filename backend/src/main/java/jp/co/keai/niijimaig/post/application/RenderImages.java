package jp.co.keai.niijimaig.post.application;

import java.util.Base64;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import jp.co.keai.niijimaig.post.domain.RenderImageNeed;

/**
 * 画像化に要る画像（背景写真・素材画像・ロゴ・最後のスライドの画像・過去の投稿の表紙）を Storage から読み、テンプレートに渡す data URL にする。
 * 呼び出し側がスライドごとに必要な画像（参照と、見つからないときの失敗理由）だけを渡す。画像が無いときは、渡された理由で画像化の失敗にするだけ
 */
final class RenderImages {

	private final RenderStorage storage;
	private final UUID tenantId;

	RenderImages(RenderStorage storage, UUID tenantId) {
		this.storage = storage;
		this.tenantId = tenantId;
	}

	/** 参照（保存先）→ data URL。団体の置き場所でない参照・無い画像は、読まずに／読めずに画像化の失敗 */
	Map<String, Object> dataUrls(Collection<RenderImageNeed> needs) {
		Map<String, Object> urls = new LinkedHashMap<>();
		for (RenderImageNeed need : needs) {
			urls.computeIfAbsent(need.ref(), ref -> dataUrl(need));
		}
		return urls;
	}

	private String dataUrl(RenderImageNeed need) {
		String ref = need.ref();
		OwnedStoragePath.require(tenantId, ref);
		// Storage の 5xx・接続失敗は一時的な失敗（ジョブの再試行）。画像が無いのは内容による失敗（理由は画像を持つ側が決めている）
		byte[] bytes = TemplateRendering.guarded("STORAGE_UNAVAILABLE", () -> storage.read(tenantId, ref))
				.orElseThrow(() -> new RenderFailedException(need.missingDetail(), need.fixableByRerun()));
		String type = ref.endsWith(".png") ? "image/png" : "image/jpeg";
		return "data:" + type + ";base64," + Base64.getEncoder().encodeToString(bytes);
	}
}
