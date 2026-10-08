import { AiDisclosure } from "../post/AiDisclosure";
import { Caption } from "../post/Caption";
import { Hashtag } from "../post/Hashtag";
import { PrCategory } from "../post/PrCategory";
import type { PostStyleSettings } from "../post/PostStyleSettings";
import { PublishCaption } from "../post/PublishCaption";
import { CoverText } from "../slide/CoverText";
import { PictureBrief } from "../slide/PictureBrief";
import { SlideList } from "../slide/SlideList";
import { SlideRole } from "../slide/SlideRole";
import { SlideText } from "../slide/SlideText";
import { readDraftJson } from "./draftJson";
import { unsupportedFactsIn } from "./unsupportedFacts";

/**
 * 下書き案: AI が生成した投稿の案（スライド構成の表紙の文言・中のスライドの文言と絵の指示・キャプション・追加のハッシュタグ・
 * PR区分・参照元URL）。生成の出力で、書き換えない。人の手直しは、取り込んだ投稿の版に対して行う。
 * 条件を満たすものだけが下書き案になる（parse が違反の一覧を返す。再生成の方針に渡す。REQ-002 BR-002-03）。
 * 生成の時点では素材画像がまだ無いので、AI生成の表示の18文字を常に見込んでキャプションの文字数を検査する（BR-002-16）
 */
export class DraftProposal {
  private constructor(
    readonly cover: CoverText,
    readonly backgroundPhotoId: string | undefined,
    private readonly slides: readonly { text: SlideText; brief: PictureBrief }[],
    readonly caption: Caption,
    readonly additionalHashtags: readonly string[],
    readonly prCategory: PrCategory,
    readonly sourceUrls: readonly string[],
  ) {}

  /**
   * 出力 JSON から下書き案を作る。条件を満たさなければ proposal は undefined で、満たさない条件を violations に並べる
   * （形が違う・文字数・強調する語・スライドの並びと枚数・追加のハッシュタグ・キャプションの残り文字数・参照元URL）。
   * context.sourceUrlRequired は、ネタの出どころがニュースか（参照元URLが1件以上要る）
   */
  static parse(raw: unknown, context: { settings: PostStyleSettings; prLabel: string; sourceUrlRequired: boolean }):
    { proposal: DraftProposal | undefined; violations: string[] } {
    const { errors, value } = readDraftJson(raw);
    if (errors.length > 0) return { proposal: undefined, violations: errors };
    const violations = DraftProposal.violationsOf(value, context);
    if (violations.length > 0) return { proposal: undefined, violations };
    const slides = value.slides.map((s) => ({
      text: SlideText.restore({ heading: s.heading, description: s.description, emphases: s.emphases }),
      brief: PictureBrief.of({ prompt: s.picturePrompt, replacementNeeded: s.needsReplacement }),
    }));
    return {
      proposal: new DraftProposal(CoverText.restore(value.cover), value.backgroundPhotoId, slides, Caption.restore(value.caption),
        [...value.additionalHashtags], PrCategory.from(value.prCategoryCode), [...value.sourceUrls]),
      violations: [],
    };
  }

  /** 中のスライドの文言と絵の指示（上から順） */
  bodies(): readonly { text: SlideText; brief: PictureBrief }[] {
    return this.slides;
  }

  /**
   * ネタの本文に無い日付・時刻・金額・URL（スライドの文言とキャプション本文から探す）。自動では消さず、人が直すか承知する（BR-002-10）。
   * location は出力 JSON の場所（cover.keyword / slides[1].description / caption など）
   */
  unsupportedFacts(ideaText: string): { location: string; fact: string }[] {
    return unsupportedFactsIn(ideaText, [
      { location: "cover.keyword", text: this.cover.keyword },
      { location: "cover.annotation", text: this.cover.annotation },
      ...this.slides.flatMap((s, i) => [
        { location: `slides[${i}].heading`, text: s.text.heading },
        { location: `slides[${i}].description`, text: s.text.description },
      ]),
      { location: "caption", text: this.caption.text },
    ]);
  }

  private static violationsOf(value: ReturnType<typeof readDraftJson>["value"], context: Parameters<typeof DraftProposal.parse>[1]): string[] {
    const prCategory = PrCategory.all().find((c) => c.code === value.prCategoryCode);
    return [
      ...CoverText.violationsOf(value.cover, context.settings),
      ...value.slides.flatMap((s, i) => DraftProposal.slideViolations(s).map((v) => `中のスライド${i + 1}枚目: ${v}`)),
      ...SlideList.violationsOf([SlideRole.COVER, ...value.slides.map(() => SlideRole.BODY), SlideRole.CLOSING]),
      ...context.settings.fixedHashtags().violationsOfAdditional(value.additionalHashtags),
      ...(prCategory ? DraftProposal.captionViolations(value, prCategory, context) : ["PR区分は NONE か PR で指定してください"]),
      ...DraftProposal.sourceUrlViolations(value.sourceUrls, context.sourceUrlRequired),
    ];
  }

  private static slideViolations(slide: ReturnType<typeof readDraftJson>["value"]["slides"][number]): string[] {
    return [
      ...SlideText.violationsOf(slide),
      ...PictureBrief.violationsOf(slide.picturePrompt).map((v) => `絵の指示: ${v}`),
    ];
  }

  /** 公開用キャプションの残りの文字数に本文が収まるか（AI生成の表示を常に見込む） */
  private static captionViolations(value: ReturnType<typeof readDraftJson>["value"], prCategory: PrCategory, context: Parameters<typeof DraftProposal.parse>[1]): string[] {
    if (value.caption.trim() === "") return ["キャプションが空です"];
    const caption = Caption.restore(value.caption);
    const validTags = value.additionalHashtags.filter((h) => Hashtag.parse(h));
    const assembled = PublishCaption.restore({
      prefix: prCategory.labelPrefix(context.prLabel), caption, disclosure: AiDisclosure.assumingRequired(),
      footer: context.settings.captionFooter(), hashtags: context.settings.fixedHashtags().mergedWith(validTags),
    });
    const remaining = assembled.remainingForCaption();
    const fits = caption.length() <= remaining;
    return [
      ...(fits ? [] : [`キャプション本文は${remaining.toLocaleString("ja-JP")}文字以内にしてください（${caption.length().toLocaleString("ja-JP")}文字。PR表記・AI生成の表示・定型・ハッシュタグを除いた残り）`]),
      ...assembled.hashtagViolations(),
    ];
  }

  private static sourceUrlViolations(urls: readonly string[], required: boolean): string[] {
    return [
      ...(required && urls.length === 0 ? ["参照元URLが1件以上必要です"] : []),
      ...urls.filter((u) => !/^https?:\/\/\S+$/u.test(u)).map((u) => `参照元URLの形が正しくありません: ${u}`),
    ];
  }
}
