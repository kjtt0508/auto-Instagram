package jp.co.keai.niijimaig.post.application;

/**
 * 画像化の失敗（画像が無い・描画の失敗・画像の仕様違反・保存の失敗）。投稿を失敗（画像化の失敗）にする。説明に本文・秘密情報を含めない。
 * 「今すぐ再実行」で直るかを運ぶ（既定は直る。最後のスライドの画像が見つからないときだけ直らない。REQ-007 BR-007-06）
 */
public class RenderFailedException extends RuntimeException {

	private final boolean fixableByRerun;

	public RenderFailedException(String detail) {
		this(detail, true);
	}

	public RenderFailedException(String detail, boolean fixableByRerun) {
		super(detail);
		this.fixableByRerun = fixableByRerun;
	}

	public RenderFailedException(String detail, Throwable cause) {
		super(detail, cause);
		this.fixableByRerun = true;
	}

	/** 「今すぐ再実行」で直るか */
	public boolean fixableByRerun() {
		return fixableByRerun;
	}
}
