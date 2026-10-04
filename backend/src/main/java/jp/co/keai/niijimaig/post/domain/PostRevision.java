package jp.co.keai.niijimaig.post.domain;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * 投稿の版: 投稿の内容の1つの版。中身は「投稿画像一覧（写真をアップロードした投稿）」か
 * 「スライド構成＋投稿の型の設定の版＋追加のハッシュタグ（テンプレートの投稿）」のどちらか一方と、キャプション・PR区分。
 * 版は変更しない。最後のスライドの過去の投稿は持たない（承認の出来事で決まり、画像化のときに SlideList.withPastPosts で渡す）。
 * TS の PostRevision と揃える
 */
public final class PostRevision {

	private final Caption caption;
	private final PrCategory prCategory;
	private final Optional<PostMediaList> photos;
	private final Optional<Template> template;

	/** テンプレートの投稿の中身 */
	private record Template(SlideList slides, PostStyleSettings settings, List<String> additionalHashtags) {
	}

	private PostRevision(Caption caption, PrCategory prCategory, Optional<PostMediaList> photos, Optional<Template> template) {
		if (caption == null || prCategory == null) {
			throw new IllegalArgumentException("キャプションとPR区分は必須");
		}
		this.caption = caption;
		this.prCategory = prCategory;
		this.photos = photos;
		this.template = template;
	}

	/** 写真をアップロードした投稿の版 */
	public static PostRevision ofPhotos(Caption caption, PrCategory prCategory, PostMediaList media) {
		return new PostRevision(caption, prCategory, Optional.of(media), Optional.empty());
	}

	/** テンプレートの投稿の版 */
	public static PostRevision ofSlides(Caption caption, PrCategory prCategory, SlideList slides, PostStyleSettings settings,
			List<String> additionalHashtags) {
		return new PostRevision(caption, prCategory, Optional.empty(),
				Optional.of(new Template(slides, settings, List.copyOf(additionalHashtags))));
	}

	/** 投稿画像一覧（テンプレートの投稿では空） */
	public PostMediaList photos() {
		return photos.orElseGet(() -> new PostMediaList(List.of()));
	}

	/** スライド構成（写真をアップロードした投稿では空） */
	public Optional<SlideList> slides() {
		return template.map(Template::slides);
	}

	/** 写真風の生成画像を含むか（投稿画像一覧かスライド構成に委ねる） */
	boolean requiresAiDisclosure() {
		return photos.map(PostMediaList::requiresAiDisclosure).orElseGet(() -> template.get().slides().requiresAiDisclosure());
	}

	/** Instagram の AI info とキャプション末尾の定型文を付けるか */
	public AiDisclosure aiDisclosure() {
		return AiDisclosure.of(this);
	}

	/** 公開用キャプションの組み立て（投稿の型の設定の版・AI生成の表示とあわせる）。上限を超えていても作る。検査は PublishCaption に尋ねる */
	public PublishCaption publishCaption(String prLabel) {
		Optional<CaptionFooter> footer = template.map(t -> t.settings().captionFooter());
		List<String> hashtags = template.map(t -> t.settings().fixedHashtags().mergedWith(t.additionalHashtags())).orElse(List.of());
		return PublishCaption.assemble(prCategory.labelPrefix(prLabel), caption.text(), aiDisclosure(), footer, hashtags);
	}

	/** 画像化に必要な画像の参照（背景写真・素材画像・ロゴの保存先）。過去の投稿の表紙は承認で決まるので含まない */
	public List<String> imageRefs() {
		List<String> refs = new ArrayList<>();
		template.ifPresent(t -> {
			refs.addAll(t.slides().imageRefs());
			t.settings().logoStoragePath().ifPresent(refs::add);
		});
		return List.copyOf(refs);
	}
}
