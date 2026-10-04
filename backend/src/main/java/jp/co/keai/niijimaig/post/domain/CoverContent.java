package jp.co.keai.niijimaig.post.domain;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/** 表紙の中身: 表紙の文言と背景写真（無ければ紺の単色）。背景写真は0〜1枚。TS の CoverContent と揃える */
public record CoverContent(CoverText text, Optional<Background> background) implements Slide.Content {

	/** 背景写真（写真IDと保存先） */
	public record Background(UUID photoId, String storagePath) {
		public Background {
			if (photoId == null || storagePath == null || storagePath.isBlank()) {
				throw new IllegalArgumentException("背景写真の写真IDと保存先は必須");
			}
		}
	}

	public CoverContent {
		if (text == null || background == null) {
			throw new IllegalArgumentException("表紙の文言と背景写真の有無は必須");
		}
	}

	@Override
	public SlideRole role() {
		return SlideRole.COVER;
	}

	@Override
	public List<String> imageRefs() {
		return background.map(b -> List.of(b.storagePath())).orElse(List.of());
	}

	@Override
	public boolean requiresAiDisclosure() {
		return false;
	}

	@Override
	public Map<String, Object> renderValues() {
		Map<String, Object> values = text.renderValues();
		background.ifPresent(b -> values.put("background", b.storagePath()));
		return values;
	}
}
