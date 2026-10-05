package jp.co.keai.niijimaig.post.domain;

import java.util.ArrayList;
import java.util.List;
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
	}

	/** テンプレートの投稿の中身。templateVersion は使うテンプレートの版の名前（例 niijima@1） */
	record TemplatePost(SlideList slides, String templateVersion, PostStyleSettings settings, List<String> additionalHashtags)
			implements RevisionContent {

		public TemplatePost {
			if (slides == null || templateVersion == null || templateVersion.isBlank() || settings == null || additionalHashtags == null) {
				throw new IllegalArgumentException("スライド構成・テンプレートの版・投稿の型の設定・追加のハッシュタグは必須");
			}
			List<String> violations = settings.fixedHashtags().violationsOfAdditional(additionalHashtags);
			if (!violations.isEmpty()) {
				throw new IllegalArgumentException(String.join("\n", violations));
			}
			additionalHashtags = List.copyOf(additionalHashtags);
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

		@Override
		public List<String> hashtags() {
			return settings.fixedHashtags().mergedWith(additionalHashtags);
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
	}
}
