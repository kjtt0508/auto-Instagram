package jp.co.keai.niijimaig.post.application;

import java.util.Base64;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/** 画像化に要る画像（背景写真・素材画像・ロゴ・過去の投稿の表紙）を Storage から読み、テンプレートに渡す data URL にする */
final class RenderImages {

	private final RenderStorage storage;
	private final UUID tenantId;

	RenderImages(RenderStorage storage, UUID tenantId) {
		this.storage = storage;
		this.tenantId = tenantId;
	}

	/** 参照（保存先）→ data URL。団体の置き場所でない参照・無い画像は、読まずに／読めずに画像化の失敗 */
	Map<String, Object> dataUrls(Collection<String> refs) {
		Map<String, Object> urls = new LinkedHashMap<>();
		for (String ref : refs) {
			urls.computeIfAbsent(ref, this::dataUrl);
		}
		return urls;
	}

	private String dataUrl(String ref) {
		OwnedStoragePath.require(tenantId, ref);
		byte[] bytes = storage.read(tenantId, ref).orElseThrow(() -> new RenderFailedException("画像化に必要な画像が見つかりません"));
		String type = ref.endsWith(".png") ? "image/png" : "image/jpeg";
		return "data:" + type + ";base64," + Base64.getEncoder().encodeToString(bytes);
	}
}
