package jp.co.keai.niijimaig.post.domain;

import java.util.ArrayList;
import java.util.List;

/**
 * 固定ハッシュタグ: 毎回付けるハッシュタグの並び（団体の設定値）。AI が足すハッシュタグはこの後ろに付き、重複は除く。
 * TS の FixedHashtags と揃える（docs/model/fixtures/caption.json）
 */
public final class FixedHashtags {

	/** AI が足すハッシュタグの最大数 */
	static final int ADDITIONAL_MAX = 5;

	private final List<Hashtag> hashtags;

	/** 各要素がハッシュタグの形でなければ例外。固定ハッシュタグの中の重複も除く */
	public FixedHashtags(List<String> texts) {
		this.hashtags = withoutDuplicates(texts.stream().map(Hashtag::new).toList());
	}

	/**
	 * 追加のハッシュタグと合わせた並び（固定が先、重複は先に出たほうを残す）。
	 * 形が正しくない追加分は並べない（TS と同じ。承認の前には violationsOfAdditional が理由を出す）
	 */
	public List<String> mergedWith(List<String> additional) {
		List<Hashtag> all = new ArrayList<>(hashtags);
		additional.stream().filter(Hashtag::isHashtag).forEach(text -> all.add(new Hashtag(text)));
		return withoutDuplicates(all).stream().map(Hashtag::toString).toList();
	}

	/** 追加のハッシュタグ（AI が足す・人が足す）が満たさない条件。0〜5個で、どれもハッシュタグの形 */
	public List<String> violationsOfAdditional(List<String> additional) {
		List<String> violations = new ArrayList<>();
		if (additional.size() > ADDITIONAL_MAX) {
			violations.add("追加のハッシュタグは" + ADDITIONAL_MAX + "個までです（" + additional.size() + "個）");
		}
		additional.stream().filter(t -> !Hashtag.isHashtag(t)).forEach(t -> violations.add("ハッシュタグの形が正しくありません: " + t));
		return List.copyOf(violations);
	}

	private static List<Hashtag> withoutDuplicates(List<Hashtag> hashtags) {
		List<Hashtag> kept = new ArrayList<>();
		for (Hashtag hashtag : hashtags) {
			if (kept.stream().noneMatch(hashtag::sameAs)) {
				kept.add(hashtag);
			}
		}
		return List.copyOf(kept);
	}
}
