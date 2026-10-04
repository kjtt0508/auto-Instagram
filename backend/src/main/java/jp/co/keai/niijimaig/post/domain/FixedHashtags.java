package jp.co.keai.niijimaig.post.domain;

import java.util.ArrayList;
import java.util.List;

/**
 * 固定ハッシュタグ: 毎回付けるハッシュタグの並び（団体の設定値）。AI が足すハッシュタグはこの後ろに付き、重複は除く。
 * TS の FixedHashtags と揃える（docs/model/fixtures/caption.json）
 */
public final class FixedHashtags {

	private final List<Hashtag> hashtags;

	/** 各要素がハッシュタグの形でなければ例外。固定ハッシュタグの中の重複も除く */
	public FixedHashtags(List<String> texts) {
		this.hashtags = withoutDuplicates(texts.stream().map(Hashtag::new).toList());
	}

	/** 追加のハッシュタグと合わせた並び（固定が先、重複は先に出たほうを残す） */
	public List<String> mergedWith(List<String> additional) {
		List<Hashtag> all = new ArrayList<>(hashtags);
		additional.forEach(text -> all.add(new Hashtag(text)));
		return withoutDuplicates(all).stream().map(Hashtag::toString).toList();
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
