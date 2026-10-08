package jp.co.keai.niijimaig.post.application;

import java.util.List;
import java.util.UUID;

/**
 * 画像化で読み書きする非公開バケットの保存先の規則（1か所）: その団体の置き場所（posts/・backgrounds/・style/・renders/）の中だけ。
 * service role で Storage を読み書きするので、記録が不正でも他団体の画像・別の場所に触れないようにする。
 */
public final class OwnedStoragePath {

	private static final List<String> FOLDERS = List.of("posts", "backgrounds", "style", "renders");
	private static final String SAFE_CHARS = "[A-Za-z0-9_./-]+";

	private OwnedStoragePath() {
	}

	/** 団体の置き場所の保存先でなければ画像化の失敗 */
	public static String require(UUID tenantId, String path) {
		if (!isOwnedBy(tenantId, path)) {
			throw new RenderFailedException("画像の保存先が正しくありません");
		}
		return path;
	}

	static boolean isOwnedBy(UUID tenantId, String path) {
		String prefix = tenantId + "/";
		if (path == null || !path.startsWith(prefix) || !path.matches(SAFE_CHARS) || path.contains("..") || path.contains("//")) {
			return false;
		}
		String rest = path.substring(prefix.length());
		return FOLDERS.stream().anyMatch(folder -> rest.startsWith(folder + "/") && rest.length() > folder.length() + 1);
	}
}
