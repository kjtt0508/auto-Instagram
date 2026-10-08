package jp.co.keai.niijimaig.post.application;

/** 画像化の失敗（画像が無い・描画の失敗・画像の仕様違反・保存の失敗）。投稿を失敗（画像化の失敗）にする。説明に本文・秘密情報を含めない */
public class RenderFailedException extends RuntimeException {

	public RenderFailedException(String detail) {
		super(detail);
	}

	public RenderFailedException(String detail, Throwable cause) {
		super(detail, cause);
	}
}
