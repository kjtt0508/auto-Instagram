package jp.co.keai.niijimaig.post.domain;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 最後のスライドの中身: 過去の投稿の表紙0〜2件（定型文とアカウントの紹介は投稿の型の設定から取る。AI は書かない）。
 * 過去の投稿は承認の出来事で決まるので、投稿の版には持たせない。画像化のときに、承認で選んだものを受け取る（REQ-002 BR-002-15）。
 * TS の ClosingContent と揃える
 */
public record ClosingContent(List<PastPostCover> pastPosts) implements Slide.Content {

	public ClosingContent {
		if (pastPosts == null || pastPosts.size() > PastPostCover.MAX_COUNT) {
			throw new IllegalArgumentException("過去の投稿の表紙は" + PastPostCover.MAX_COUNT + "件までです");
		}
		pastPosts = List.copyOf(pastPosts);
	}

	/** 投稿の版が持つ姿（過去の投稿はまだ決まっていない） */
	public static ClosingContent empty() {
		return new ClosingContent(List.of());
	}

	@Override
	public SlideRole role() {
		return SlideRole.CLOSING;
	}

	@Override
	public List<String> imageRefs() {
		return pastPosts.stream().map(PastPostCover::coverStoragePath).toList();
	}

	@Override
	public boolean requiresAiDisclosure() {
		return false;
	}

	@Override
	public boolean needsApprovalCheck() {
		return false;
	}

	@Override
	public Map<String, Object> renderValues() {
		Map<String, Object> values = new LinkedHashMap<>();
		values.put("pastPosts", imageRefs());
		return values;
	}
}
