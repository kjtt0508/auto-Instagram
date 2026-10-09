package jp.co.keai.niijimaig.post.application;

import java.time.Instant;

import jp.co.keai.niijimaig.post.domain.Post;

/** 公開用画像の準備のしかた（投稿の版の preparation() が選ぶ: 複製か画像化か） */
interface PreparationMethod {

	/**
	 * 公開用画像を準備する。済んでいるものは作り直さない（冪等）。
	 *
	 * @param deadline この時刻を過ぎたら新しい作業を始めない（一時的な失敗として返す。写真の投稿の公開の時間を残すため）
	 */
	void prepare(Post post, Instant deadline);
}
