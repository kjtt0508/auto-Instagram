import { Hashtag } from "./Hashtag";

/**
 * 固定ハッシュタグ: 毎回付けるハッシュタグの並び（団体の設定値）。AI が足すハッシュタグはこの後ろに付き、重複は除く。
 * Java の FixedHashtags と揃える（docs/model/fixtures/caption.json）
 */
export class FixedHashtags {
  /** AI が足すハッシュタグの最大数 */
  static readonly ADDITIONAL_MAX = 5;

  private constructor(private readonly hashtags: readonly Hashtag[]) {}

  /** 各要素がハッシュタグの形でなければ例外。固定ハッシュタグの中の重複も除く */
  static of(texts: readonly string[]): FixedHashtags {
    return new FixedHashtags(FixedHashtags.withoutDuplicates(texts.map((t) => Hashtag.of(t))));
  }

  /**
   * 追加のハッシュタグと合わせた並び（固定が先、重複は先に出たほうを残す）。
   * 形が正しくない追加分は並べない（入力中の表示を止めないため。承認の前には violationsOfAdditional が理由を出す）
   */
  mergedWith(additional: readonly string[]): readonly string[] {
    const wellFormed = additional.flatMap((t) => Hashtag.parse(t) ?? []);
    return FixedHashtags.withoutDuplicates([...this.hashtags, ...wellFormed]).map((h) => h.text);
  }

  /** 追加のハッシュタグ（AI が足す・人が足す）が満たさない条件。0〜5個で、どれもハッシュタグの形 */
  violationsOfAdditional(additional: readonly string[]): string[] {
    return [
      ...(additional.length > FixedHashtags.ADDITIONAL_MAX
        ? [`追加のハッシュタグは${FixedHashtags.ADDITIONAL_MAX}個までです（${additional.length}個）`] : []),
      ...additional.filter((t) => !Hashtag.parse(t)).map((t) => `ハッシュタグの形が正しくありません: ${t}`),
    ];
  }

  texts(): readonly string[] {
    return this.hashtags.map((h) => h.text);
  }

  private static withoutDuplicates(hashtags: readonly Hashtag[]): Hashtag[] {
    return hashtags.reduce<Hashtag[]>((kept, h) => (kept.some((k) => k.sameAs(h)) ? kept : [...kept, h]), []);
  }
}
