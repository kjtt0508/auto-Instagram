package jp.co.keai.niijimaig.post.domain;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.stream.IntStream;

/** 投稿画像一覧: 順番が1から連番。カルーセルでは全画像が1枚目と同じ比率 */
public final class PostMediaList {

	private final List<PostMedia> media;

	public PostMediaList(List<PostMedia> media) {
		List<PostMedia> sorted = media.stream().sorted(Comparator.comparingInt(PostMedia::position)).toList();
		boolean consecutive = IntStream.range(0, sorted.size()).allMatch(i -> sorted.get(i).position() == i + 1);
		if (!consecutive) {
			throw new IllegalArgumentException("投稿画像の順番は1から連番です");
		}
		this.media = sorted;
	}

	public int count() {
		return media.size();
	}

	/** 投稿種別とあわせて、公開できない理由を列挙する（空なら公開できる） */
	public List<String> violationsFor(PostFormat format, ImageSpec spec) {
		List<String> violations = new ArrayList<>();
		if (!format.acceptsMediaCount(count())) {
			violations.add(format.mediaCountRule());
		}
		media.forEach(m -> spec.violationsOf(m).forEach(v -> violations.add(m.position() + "枚目: " + v)));
		if (!allSameAspect()) {
			violations.add("カルーセルの画像は1枚目と同じ縦横比にそろえてください");
		}
		return List.copyOf(violations);
	}

	/** 公開用の準備がまだ済んでいない画像（prepared に同じ順番の画像が無いもの） */
	public List<PostMedia> notYetIn(PostMediaList prepared) {
		return media.stream().filter(m -> !prepared.hasPosition(m.position())).toList();
	}

	private boolean hasPosition(int position) {
		return media.stream().anyMatch(m -> m.position() == position);
	}

	/** 写真風の生成画像を1枚でも含むか（AI生成の表示が要る。BR-005-05） */
	boolean requiresAiDisclosure() {
		return media.stream().anyMatch(PostMedia::requiresAiDisclosure);
	}

	/** 承認時に「写真風の生成画像を含みます」の確認が要るか */
	boolean needsApprovalCheck() {
		return media.stream().anyMatch(PostMedia::needsApprovalCheck);
	}

	public List<String> storagePaths() {
		return media.stream().map(PostMedia::storagePath).toList();
	}

	private boolean allSameAspect() {
		if (media.isEmpty()) {
			return true;
		}
		PostMedia first = media.get(0);
		return media.stream().allMatch(first::sameAspectAs);
	}
}
