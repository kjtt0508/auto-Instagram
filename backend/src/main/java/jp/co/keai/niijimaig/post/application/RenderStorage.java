package jp.co.keai.niijimaig.post.application;

import java.util.Optional;
import java.util.UUID;

/**
 * 画像化で使う非公開バケット（uploads-private）の読み書き。実装は infrastructure。
 * 保存先は OwnedStoragePath の規則（その団体の置き場所の中）に合うものだけ。合わなければ読み書きせず画像化の失敗にする
 */
public interface RenderStorage {

	/** 団体の非公開バケットの画像。無ければ空 */
	Optional<byte[]> read(UUID tenantId, String privatePath);

	/** 画像化した JPEG を保存する（同じパスは上書き） */
	void save(UUID tenantId, String privatePath, byte[] jpeg);
}
