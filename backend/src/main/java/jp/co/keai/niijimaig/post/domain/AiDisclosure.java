package jp.co.keai.niijimaig.post.domain;

/**
 * AI生成の表示: 写真風の生成画像を含む投稿を公開するときに付ける開示（REQ-005 BR-005-05）。
 * キャプション末尾の定型文（改行1つ＋文言。改行込み18文字）と、Instagram の AI info（is_ai_generated）。TS の AiDisclosure と揃える
 */
public final class AiDisclosure {

	static final String TEXT = "※画像はAIで生成したイメージです";
	static final String SEPARATOR = "\n";
	static final String NAME = "AI生成の表示";

	private final boolean required;

	private AiDisclosure(boolean required) {
		this.required = required;
	}

	/** 投稿画像一覧から、表示が要るかを決める（写真風の生成画像を1枚でも含むとき） */
	public static AiDisclosure of(PostMediaList media) {
		return new AiDisclosure(media.requiresAiDisclosure());
	}

	/** キャプション末尾の定型文と、Instagram の AI info の両方を付けるか */
	public boolean isRequired() {
		return required;
	}

	/** 公開用キャプションの末尾に付ける文字列（不要なら空） */
	public String suffix() {
		return required ? SEPARATOR + TEXT : "";
	}
}
