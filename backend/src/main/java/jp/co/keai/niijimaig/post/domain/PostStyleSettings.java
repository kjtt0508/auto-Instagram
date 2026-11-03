package jp.co.keai.niijimaig.post.domain;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * 投稿の型の設定: 団体ごとの投稿の型の固定の文言・候補（上端の帯の文言・表紙の対象の候補・最後のスライドの定型文・
 * アカウントの紹介・キャプションの定型・固定ハッシュタグ・ロゴ・最後のスライドの画像一覧）。AI は書き換えない。版で管理し、版は変更しない。
 * 最後のスライドの画像一覧はテンプレートに渡す設定の値（renderValues）には入れず、最後のスライドの中身として渡す（REQ-007）。
 * TS の PostStyleSettings と揃える
 */
public record PostStyleSettings(UUID tenantId, int version, String bandText, List<String> coverTargets, String closingMessage,
		String accountIntroduction, CaptionFooter captionFooter, FixedHashtags fixedHashtags, Optional<String> logoStoragePath,
		ClosingImageList closingImages) {

	public PostStyleSettings {
		if (tenantId == null || bandText == null || closingMessage == null || accountIntroduction == null
				|| captionFooter == null || fixedHashtags == null || logoStoragePath == null || closingImages == null) {
			throw new IllegalArgumentException("投稿の型の設定の項目は必須");
		}
		if (version < 1) {
			throw new IllegalArgumentException("版は1以上: " + version);
		}
		if (coverTargets == null || coverTargets.isEmpty()) {
			throw new IllegalArgumentException("表紙の対象の候補は1件以上必要です");
		}
		coverTargets = List.copyOf(coverTargets);
	}

	/** 表紙の対象の候補に含まれるか */
	public boolean acceptsCoverTarget(String target) {
		return coverTargets.contains(target);
	}

	/** ロゴ（あれば）の画像の参照と、Storage に見つからないときの失敗理由（画像化の既定の文言） */
	public Optional<RenderImageNeed> logoImageNeed() {
		return logoStoragePath.map(RenderImageNeed::of);
	}

	/** 画像化でテンプレートに渡す固定の文言（上端の帯・最後のスライドの定型文・アカウントの紹介）とロゴの画像の参照 */
	public Map<String, Object> renderValues() {
		Map<String, Object> values = new LinkedHashMap<>();
		values.put("bandText", bandText);
		values.put("closingMessage", closingMessage);
		values.put("accountIntroduction", accountIntroduction);
		logoStoragePath.ifPresent(path -> values.put("logo", path));
		return values;
	}
}
