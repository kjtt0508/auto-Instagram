package jp.co.keai.niijimaig.post.application;

import java.util.UUID;

/** 画像の保存先（Supabase Storage。実装は infrastructure） */
public interface MediaStorage {

	/** 非公開バケットの画像を、公開バケットの推測できないパスに複製し、そのパスを返す */
	String copyToPublic(UUID tenantId, String privatePath);

	/**
	 * 非公開バケットの画像を、公開バケットの {団体}/{名前}.jpg に複製し、そのパスを返す。名前は idempotencyKey から決まるので、
	 * 同じ鍵なら同じパスになり、複製済みでも成功する（再試行で孤児を作らない）。名前は鍵を知らない人には推測できない
	 */
	String copyToPublic(UUID tenantId, String privatePath, String idempotencyKey);

	/** Instagram が取得する公開URL */
	String publicUrl(String publicPath);
}
