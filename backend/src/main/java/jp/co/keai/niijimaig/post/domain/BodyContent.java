package jp.co.keai.niijimaig.post.domain;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * 中のスライドの中身: スライドの文言・素材画像（無くてよい。無ければ文字だけのカード）。素材画像は0〜1枚。
 * 絵の指示は素材画像を作る操作のためのもので、画像化では使わない。TS の BodyContent と揃える
 */
public record BodyContent(SlideText text, Optional<MaterialImage> material) implements Slide.Content {

	public BodyContent {
		if (text == null || material == null) {
			throw new IllegalArgumentException("スライドの文言と素材画像の有無は必須");
		}
	}

	@Override
	public SlideRole role() {
		return SlideRole.BODY;
	}

	@Override
	public List<String> imageRefs() {
		return material.map(m -> List.of(m.storagePath())).orElse(List.of());
	}

	/** 写真風の生成画像を含むか（素材画像に委ねる） */
	@Override
	public boolean requiresAiDisclosure() {
		return material.map(MaterialImage::requiresAiDisclosure).orElse(false);
	}

	@Override
	public boolean needsApprovalCheck() {
		return material.map(MaterialImage::needsApprovalCheck).orElse(false);
	}

	@Override
	public Map<String, Object> renderValues() {
		Map<String, Object> values = new LinkedHashMap<>();
		values.put("heading", text.heading());
		values.put("segments", text.segments().stream()
				.map(s -> Map.<String, Object>of("text", s.text(), "emphasized", s.emphasized())).toList());
		material.ifPresent(m -> values.put("material", m.storagePath()));
		return values;
	}
}
