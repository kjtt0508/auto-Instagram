package jp.co.keai.niijimaig.post.domain;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * スライド: 投稿画像1枚分の内容。スライド役割と、その役割の中身（表紙の中身・中のスライドの中身・最後のスライドの中身のどれか）の組。
 * 役割と中身の型は、中身から役割を決めるので必ず合う。TS の Slide と揃える
 */
public record Slide(Content content) {

	/** 役割ごとの中身（表紙の中身・中のスライドの中身・最後のスライドの中身） */
	public sealed interface Content permits CoverContent, BodyContent, ClosingContent {

		SlideRole role();

		/** 画像化に必要な画像の参照（保存先）の一覧 */
		List<String> imageRefs();

		/** 写真風の生成画像を含むか */
		boolean requiresAiDisclosure();

		/** 承認時に「写真風の生成画像を含みます」の確認が要るか */
		boolean needsApprovalCheck();

		/** 画像化でテンプレートに渡す値 */
		Map<String, Object> renderValues();
	}

	public Slide {
		if (content == null) {
			throw new IllegalArgumentException("スライドの中身は必須");
		}
	}

	public SlideRole role() {
		return content.role();
	}

	/** 画像化に必要な画像の参照（保存先）の一覧。実際にあるかは画像化の側で確かめ、無ければ画像化の失敗 */
	public List<String> imageRefs() {
		return content.imageRefs();
	}

	/** 写真風の生成画像を含むか（中身に委ねる） */
	public boolean requiresAiDisclosure() {
		return content.requiresAiDisclosure();
	}

	/** 承認時の確認が要るか（中身に委ねる） */
	public boolean needsApprovalCheck() {
		return content.needsApprovalCheck();
	}

	/** 画像化でテンプレートに渡す値（役割を添える。TS の Slide.renderValues と同じ形。docs/model/fixtures/render-values.json） */
	public Map<String, Object> renderValues() {
		Map<String, Object> values = new LinkedHashMap<>();
		values.put("role", role().name());
		values.putAll(content.renderValues());
		return values;
	}
}
