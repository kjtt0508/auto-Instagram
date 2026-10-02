package jp.co.keai.niijimaig.post.application;

import java.util.UUID;

/** 画像の保存先（Supabase Storage。実装は infrastructure） */
public interface MediaStorage {

	/** 非公開バケットの画像を、公開バケットの推測できないパスに複製し、そのパスを返す */
	String copyToPublic(UUID tenantId, String privatePath);

	/** Instagram が取得する公開URL */
	String publicUrl(String publicPath);
}
