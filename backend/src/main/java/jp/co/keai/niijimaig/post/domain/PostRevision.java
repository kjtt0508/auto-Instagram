package jp.co.keai.niijimaig.post.domain;

import java.util.List;

/**
 * 投稿の版: 投稿の内容の1つの版。投稿の版の中身（写真の投稿は投稿画像一覧、テンプレートの投稿はスライド構成・テンプレートの版・
 * 投稿の型の設定の版・追加のハッシュタグ）と、キャプション・PR区分。形ごとの違いは中身に委ね、ここでは分岐しない。
 * 版は変更しない。最後のスライドの過去の投稿は持たない（承認の出来事で決まり、画像化のときに SlideList.withPastPosts で渡す）。
 * TS の PostRevision と揃える
 */
public final class PostRevision {

	private final Caption caption;
	private final PrCategory prCategory;
	private final RevisionContent content;

	private PostRevision(Caption caption, PrCategory prCategory, RevisionContent content) {
		if (caption == null || prCategory == null || content == null) {
			throw new IllegalArgumentException("キャプション・PR区分・投稿の版の中身は必須");
		}
		this.caption = caption;
		this.prCategory = prCategory;
		this.content = content;
	}

	/** 写真をアップロードした投稿の版 */
	public static PostRevision ofPhotos(Caption caption, PrCategory prCategory, PostMediaList media) {
		return new PostRevision(caption, prCategory, new RevisionContent.PhotoPost(media));
	}

	/** テンプレートの投稿の版（templateVersion は例 niijima@1。追加のハッシュタグは0〜5個で、どれもハッシュタグの形） */
	public static PostRevision ofSlides(Caption caption, PrCategory prCategory, SlideList slides, String templateVersion,
			PostStyleSettings settings, List<String> additionalHashtags) {
		return new PostRevision(caption, prCategory,
				new RevisionContent.TemplatePost(slides, templateVersion, settings, additionalHashtags));
	}

	/** 公開用画像が何枚になるか（中身に委ねる） */
	public int expectedPublishMediaCount() {
		return content.expectedPublishMediaCount();
	}

	/** 公開用画像の準備のしかた（複製か画像化か。中身に委ねる） */
	public RevisionContent.Preparation preparation() {
		return content.preparation();
	}

	/** 写真風の生成画像を含むか（中身に委ねる） */
	boolean requiresAiDisclosure() {
		return content.requiresAiDisclosure();
	}

	/** 承認時の確認（「写真風の生成画像を含みます」）が要るか（中身に委ねる） */
	public boolean needsApprovalCheck() {
		return content.needsApprovalCheck();
	}

	/** Instagram の AI info とキャプション末尾の定型文を付けるか */
	public AiDisclosure aiDisclosure() {
		return AiDisclosure.of(this);
	}

	/** 公開用キャプションの組み立て（投稿の型の設定の版・AI生成の表示とあわせる）。上限を超えていても作る。検査は PublishCaption に尋ねる */
	public PublishCaption publishCaption(String prLabel) {
		return PublishCaption.assemble(prCategory.labelPrefix(prLabel), caption.text(), aiDisclosure(), content.captionFooter(),
				content.hashtags());
	}

	/** 元の画像が公開できない理由（中身に委ねる） */
	List<String> violationsOfSourceImages(PostFormat format, ImageSpec spec) {
		return content.violationsOfSourceImages(format, spec);
	}

	/** 複製の準備で、まだ公開用の保存先に複製していない元の画像（中身に委ねる） */
	List<PostMedia> originalsNotYetIn(PostMediaList prepared) {
		return content.originalsNotYetIn(prepared);
	}

	/** 画像化に必要な画像の参照（背景写真・素材画像・ロゴの保存先）。過去の投稿の表紙は承認で決まるので含まない */
	public List<String> imageRefs() {
		return content.imageRefs();
	}
}
