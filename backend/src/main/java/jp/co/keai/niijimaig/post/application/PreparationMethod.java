package jp.co.keai.niijimaig.post.application;

import jp.co.keai.niijimaig.post.domain.Post;

/** 公開用画像の準備のしかた（投稿の版の preparation() が選ぶ: 複製か画像化か） */
interface PreparationMethod {

	/** 公開用画像を準備する。済んでいるものは作り直さない（冪等） */
	void prepare(Post post);
}
