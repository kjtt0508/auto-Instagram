package jp.co.keai.niijimaig.post.domain;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * 投稿の版の中身: 投稿の形ごとに異なる中身。2つの形のどちらか一方だけを取る。
 * 写真の投稿＝投稿画像一覧／テンプレートの投稿＝スライド構成・テンプレートの版・投稿の型の設定の版・追加のハッシュタグ。
 * 形ごとの違い（枚数・準備のしかた・AI生成の表示・足す定型とハッシュタグ）は、呼び出し側が分岐せず中身に尋ねる。
 * TS の RevisionContent と揃える
 */
public sealed interface RevisionContent {

	/** 公開用画像の準備のしかた（アップロードの投稿は公開用の保存先への複製、テンプレートの投稿は画像化） */
	enum Preparation {
		COPY,
		RENDER
	}

	/** 公開用画像が何枚になるか */
	int expectedPublishMediaCount();

	Preparation preparation();

	/** 写真風の生成画像を含むか */
	boolean requiresAiDisclosure();

	/** 承認時に「写真風の生成画像を含みます」の確認が要るか */
	boolean needsApprovalCheck();

	/** 公開用キャプションに足すキャプションの定型（写真の投稿は無し） */
	Optional<CaptionFooter> captionFooter();

	/** 公開用キャプションに足すハッシュタグ（固定→追加、重複を除く。写真の投稿は無し） */
	List<String> hashtags();

	/** 画像化に必要な画像の参照（背景写真・素材画像・ロゴの保存先。写真の投稿は無し） */
	List<String> imageRefs();

	/** 元の画像が公開できない理由（写真の投稿は投稿画像の仕様。テンプレートの投稿は画像化した画像を検査するのでここでは無し） */
	List<String> violationsOfSourceImages(PostFormat format, ImageSpec spec);

	/** 複製の準備で、まだ公開用の保存先に複製していない元の画像（複製しない形では無し） */
	List<PostMedia> originalsNotYetIn(PostMediaList prepared);

	/**
	 * 中身が満たさない条件（スライド構成の並びと枚数は SlideList が作るときに守るので、ここでは追加のハッシュタグ）。
	 * 記録から戻すときは検査しないので、承認を依頼するとき・公開するときに呼び出し側がこれを確かめる
	 */
	List<String> violations();

	/** 画像化に使うテンプレートの版の名前（写真の投稿は無し） */
	Optional<String> renderTemplateVersion();

	/** 画像化でテンプレートに渡すスライドごとの値（最後のスライドには承認で選んだ過去の投稿を載せる。写真の投稿は無し） */
	List<Map<String, Object>> slideRenderValues(List<PastPostCover> pastPosts);

	/** 画像化でテンプレートに渡す投稿の型の設定の値（写真の投稿は無し） */
	Map<String, Object> settingsRenderValues();

	/** 写真をアップロードした投稿の中身 */
	record PhotoPost(PostMediaList media) implements RevisionContent {

		public PhotoPost {
			if (media == null) {
				throw new IllegalArgumentException("投稿画像一覧は必須");
			}
		}

		@Override
		public int expectedPublishMediaCount() {
			return media.count();
		}

		@Override
		public Preparation preparation() {
			return Preparation.COPY;
		}

		@Override
		public boolean requiresAiDisclosure() {
			return media.requiresAiDisclosure();
		}

		@Override
		public boolean needsApprovalCheck() {
			return media.needsApprovalCheck();
		}

		@Override
		public Optional<CaptionFooter> captionFooter() {
			return Optional.empty();
		}

		@Override
		public List<String> hashtags() {
			return List.of();
		}

		@Override
		public List<String> imageRefs() {
			return List.of();
		}

		@Override
		public List<String> violationsOfSourceImages(PostFormat format, ImageSpec spec) {
			return media.violationsFor(format, spec);
		}

		@Override
		public List<PostMedia> originalsNotYetIn(PostMediaList prepared) {
			return media.notYetIn(prepared);
		}

		@Override
		public List<String> violations() {
			return List.of();
		}

		@Override
		public Optional<String> renderTemplateVersion() {
			return Optional.empty();
		}

		@Override
		public List<Map<String, Object>> slideRenderValues(List<PastPostCover> pastPosts) {
			return List.of();
		}

		@Override
		public Map<String, Object> settingsRenderValues() {
			return Map.of();
		}
	}

	/**
	 * テンプレートの投稿の中身。templateVersion は使うテンプレートの版の名前（例 niijima@1）。
	 * 追加のハッシュタグの個数・形は、コンストラクタ（記録から戻す経路）では検査しない（DB は形だけを検査して保存するので、
	 * 読み戻しで止まらないように）。満たさない条件は violations() で返す。新しく作るときは of が検査する
	 */
	record TemplatePost(SlideList slides, String templateVersion, PostStyleSettings settings, List<String> additionalHashtags)
			implements RevisionContent {

		public TemplatePost {
			if (slides == null || templateVersion == null || templateVersion.isBlank() || settings == null || additionalHashtags == null) {
				throw new IllegalArgumentException("スライド構成・テンプレートの版・投稿の型の設定・追加のハッシュタグは必須");
			}
			additionalHashtags = List.copyOf(additionalHashtags);
		}

		/** 新しく作る: 追加のハッシュタグを検査し、満たさなければ例外 */
		static TemplatePost of(SlideList slides, String templateVersion, PostStyleSettings settings, List<String> additionalHashtags) {
			TemplatePost content = new TemplatePost(slides, templateVersion, settings, additionalHashtags);
			List<String> violations = content.violations();
			if (!violations.isEmpty()) {
				throw new IllegalArgumentException(String.join("\n", violations));
			}
			return content;
		}

		@Override
		public int expectedPublishMediaCount() {
			return slides.count();
		}

		@Override
		public Preparation preparation() {
			return Preparation.RENDER;
		}

		@Override
		public boolean requiresAiDisclosure() {
			return slides.requiresAiDisclosure();
		}

		@Override
		public boolean needsApprovalCheck() {
			return slides.needsApprovalCheck();
		}

		@Override
		public Optional<CaptionFooter> captionFooter() {
			return Optional.of(settings.captionFooter());
		}

		/** ハッシュタグの形でないものは足さない（形の違反は violations() が返し、公開は止まる） */
		@Override
		public List<String> hashtags() {
			return settings.fixedHashtags().mergedWith(additionalHashtags.stream().filter(Hashtag::isHashtag).toList());
		}

		@Override
		public List<String> imageRefs() {
			List<String> refs = new ArrayList<>(slides.imageRefs());
			settings.logoStoragePath().ifPresent(refs::add);
			return List.copyOf(refs);
		}

		@Override
		public List<String> violationsOfSourceImages(PostFormat format, ImageSpec spec) {
			return List.of();
		}

		@Override
		public List<PostMedia> originalsNotYetIn(PostMediaList prepared) {
			return List.of();
		}

		@Override
		public List<String> violations() {
			return settings.fixedHashtags().violationsOfAdditional(additionalHashtags);
		}

		@Override
		public Optional<String> renderTemplateVersion() {
			return Optional.of(templateVersion);
		}

		@Override
		public List<Map<String, Object>> slideRenderValues(List<PastPostCover> pastPosts) {
			return slides.withPastPosts(pastPosts).renderValues();
		}

		@Override
		public Map<String, Object> settingsRenderValues() {
			return settings.renderValues();
		}
	}
}
