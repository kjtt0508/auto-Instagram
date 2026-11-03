package jp.co.keai.niijimaig.post.domain;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * 最後のスライドの中身: 真ん中に並べる画像0〜2枚（定型文とアカウントの紹介は投稿の型の設定から取る。AI は書かない）。
 * 並べる画像は、投稿の型の設定の版の最後のスライドの画像（REQ-007）。REQ-007 より前の承認で過去の投稿の表紙を記録していれば、その表紙。
 * 投稿の版には持たせず、プレビューと画像化のときに受け取る。
 * 作り方は fromClosingImages（設定の画像から）と fromApproval（承認の記録から。記録の表紙が1件以上あればそれ、無ければ設定の画像。BR-007-05）。
 * 画像が見つからないときの失敗は参照ごとに持つ（設定の画像は BR-007-06 の文言で「今すぐ再実行」では直らない、過去の投稿の表紙は画像化の既定の文言）。
 * TS の ClosingContent と揃える
 */
public final class ClosingContent implements Slide.Content {

	/** 並べられる画像の最大枚数（この上限「2」の持ち主。niijima@1 の枠の数。最後のスライドの画像一覧・過去の投稿の表紙はこれを参照する） */
	public static final int MAX_IMAGES = 2;

	/** 設定の最後のスライドの画像が Storage に見つからないときの失敗の詳細（BR-007-06。「今すぐ再実行」では直らない） */
	public static final String MISSING_CLOSING_IMAGE_DETAIL =
			"最後のスライドの画像が見つかりません。管理者が画像を設定し直したあと、下書きに戻して保存し直してください";

	private final List<RenderImageNeed> needs;

	private ClosingContent(List<RenderImageNeed> needs) {
		if (needs == null || needs.size() > MAX_IMAGES) {
			throw new IllegalArgumentException("最後のスライドに並べる画像は" + MAX_IMAGES + "枚までです");
		}
		this.needs = List.copyOf(needs);
	}

	/** 投稿の版が持つ姿（並べる画像はまだ決まっていない） */
	public static ClosingContent empty() {
		return fromClosingImages(ClosingImageList.empty());
	}

	/** 設定の最後のスライドの画像から作る（プレビュー・画像化） */
	public static ClosingContent fromClosingImages(ClosingImageList closingImages) {
		Objects.requireNonNull(closingImages, "最後のスライドの画像一覧は必須");
		return new ClosingContent(closingImages.refs().stream()
				.map(ref -> RenderImageNeed.notFixableByRerun(ref, MISSING_CLOSING_IMAGE_DETAIL)).toList());
	}

	/**
	 * 投稿履歴（承認）の記録から作る: 記録した過去の投稿の表紙が1件以上あればその表紙（REQ-007 より前の承認。設定の画像には変えない）、
	 * 無ければ設定の最後のスライドの画像（画像化と、承認済みの投稿の表示が同じ画像になる）
	 */
	public static ClosingContent fromApproval(List<PastPostCover> pastPosts, ClosingImageList closingImages) {
		Objects.requireNonNull(pastPosts, "過去の投稿の表紙の記録は必須");
		if (pastPosts.isEmpty()) {
			return fromClosingImages(closingImages);
		}
		if (pastPosts.size() > MAX_IMAGES) {
			throw new IllegalArgumentException("過去の投稿の表紙は" + MAX_IMAGES + "件までです");
		}
		return new ClosingContent(pastPosts.stream().map(p -> RenderImageNeed.of(p.coverStoragePath())).toList());
	}

	@Override
	public SlideRole role() {
		return SlideRole.CLOSING;
	}

	/** 並べる順の画像。見つからないときの失敗の詳細と再実行で直るかは参照ごとに添える（設定の画像は直らない、過去の投稿の表紙は今のまま） */
	@Override
	public List<RenderImageNeed> imageNeeds() {
		return needs;
	}

	@Override
	public boolean requiresAiDisclosure() {
		return false;
	}

	@Override
	public boolean needsApprovalCheck() {
		return false;
	}

	/** niijima@1 の差し込み値。名前は pastPosts のままで、中身は「並べる画像の参照」（niijima@2 を作るときに名前を直す） */
	@Override
	public Map<String, Object> renderValues() {
		Map<String, Object> values = new LinkedHashMap<>();
		values.put("pastPosts", imageRefs());
		return values;
	}

	@Override
	public boolean equals(Object o) {
		return o instanceof ClosingContent c && c.needs.equals(needs);
	}

	@Override
	public int hashCode() {
		return needs.hashCode();
	}

	@Override
	public String toString() {
		return "ClosingContent" + imageRefs();
	}
}
