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
import { PromptPurpose } from "./PromptPurpose";
import { unsupportedFactsIn } from "./unsupportedFacts";

/**
 * 下書き案: AI が生成した投稿の案（スライド構成の表紙の文言・中のスライドの文言と絵の指示・キャプション・追加のハッシュタグ・
 * PR区分・参照元URL）。生成の出力で、書き換えない。人の手直しは、取り込んだ投稿の版に対して行う。
 * 条件を満たすものだけが下書き案になる（parse が違反の一覧を返す。再生成の方針に渡す。REQ-002 BR-002-03）。
 * 生成の時点では素材画像がまだ無いので、AI生成の表示の18文字を常に見込んでキャプションの文字数を検査する（BR-002-16）
 */
export class DraftProposal {
  /** 修正の依頼で送られる現在の下書き（current）の大きさの上限（JSON にしたときの文字数）。超える巨大な値は受け付けない */
  static readonly CURRENT_MAX_LENGTH = 32_768;

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
  static parse(raw: unknown, context: {
    settings: PostStyleSettings; prLabel: string; sourceUrlRequired: boolean;
    /** 省くと最初の生成（PLAN） */
    purpose?: PromptPurpose;
    /** PLAN で AI が選んでよい背景写真のID（省くと選んだIDを検査しない・0件なら捨てる） */
    backgroundPhotoIds?: readonly string[];
    /** 修正で保つもの（中のスライドの枚数・PR区分・参照元URL）。REVISE で必須 */
    keep?: { bodySlideCount: number; prCategory: string; sourceUrls: readonly string[] };
  }): { proposal: DraftProposal | undefined; violations: string[] } {
    const { errors, value } = readDraftJson(DraftProposal.adjusted(raw, context));
    const extra = DraftProposal.purposeViolations(raw, context);
    if (errors.length > 0) return { proposal: undefined, violations: [...errors, ...extra] };
    const violations = [...DraftProposal.violationsOf(value, context), ...extra];
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

  /**
   * 修正の依頼で送られた現在の下書き（current）を読む。下書き案と同じ形（draftJson）で読み、知らない欄は捨てて、下書き案の形に
   * 整えたものを返す（プロンプトと生成の記録にはこれだけを使う）。形が違う・大きすぎる・中のスライドの枚数が範囲外・PR区分が
   * 不正なら理由の一覧を返す。文字数の違反は受け付ける（画面で赤字のままでも、直す指示を出して作り直せるように）。
   * keep は修正で保つもの（中のスライドの枚数・PR区分・参照元URL）
   */
  static readCurrent(current: unknown):
    { ok: true; draft: Record<string, unknown>; keep: { bodySlideCount: number; prCategory: string; sourceUrls: readonly string[] } } | { ok: false; errors: string[] } {
    if (typeof current !== "object" || current === null || Array.isArray(current)) {
      return { ok: false, errors: ["current は下書き案と同じ形のオブジェクトで指定してください"] };
    }
    if (JSON.stringify(current).length > DraftProposal.CURRENT_MAX_LENGTH) {
      return { ok: false, errors: [`current が大きすぎます（JSON で${DraftProposal.CURRENT_MAX_LENGTH.toLocaleString("ja-JP")}文字まで）`] };
    }
    const { errors, value } = readDraftJson(current);
    const bodyCount = value.slides.length;
    const rangeErrors = SlideList.violationsOf([SlideRole.COVER, ...Array.from({ length: bodyCount }, () => SlideRole.BODY), SlideRole.CLOSING]);
    const prErrors = PrCategory.all().some((c) => c.code === value.prCategoryCode) ? [] : ["prCategory は NONE か PR で指定してください"];
    if (errors.length + rangeErrors.length + prErrors.length > 0) return { ok: false, errors: [...errors, ...rangeErrors, ...prErrors] };
    const draft = {
      cover: { target: value.cover.target, keyword: value.cover.keyword, annotation: value.cover.annotation,
        closingWords: value.cover.closingWords, accent: value.cover.accentCode },
      slides: value.slides.map((s) => ({ heading: s.heading, description: s.description, emphases: [...s.emphases],
        picturePrompt: s.picturePrompt, needsReplacement: s.needsReplacement })),
      caption: value.caption, additionalHashtags: [...value.additionalHashtags], prCategory: value.prCategoryCode,
      sourceUrls: [...value.sourceUrls],
    };
    return { ok: true, draft, keep: { bodySlideCount: bodyCount, prCategory: value.prCategoryCode, sourceUrls: value.sourceUrls } };
  }

  /** 中のスライドの文言と絵の指示（上から順） */
  bodies(): readonly { text: SlideText; brief: PictureBrief }[] {
    return this.slides;
  }

  /**
   * 出力 JSON と同じ形の値（API の応答・生成の記録。再び parse に渡せる）。
   * 背景写真が無い（候補が 0枚・修正で変えない）ときは null
   */
  toJson() {
    return {
      cover: { target: this.cover.target, keyword: this.cover.keyword, annotation: this.cover.annotation,
        closingWords: this.cover.closingWords, accent: this.cover.accent.code },
      backgroundPhotoId: this.backgroundPhotoId ?? null,
      slides: this.slides.map((s) => ({ heading: s.text.heading, description: s.text.description, emphases: [...s.text.emphases],
        picturePrompt: s.brief.promptText(), needsReplacement: s.brief.needsReplacement() })),
      caption: this.caption.text,
      additionalHashtags: [...this.additionalHashtags],
      prCategory: this.prCategory.code,
      sourceUrls: [...this.sourceUrls],
    };
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

  /**
   * 用途による調整。修正（REVISE）は背景写真を変えず、PR区分・参照元URLを現在のまま保つ。
   * 最初の生成（PLAN）は、背景写真の候補が 0枚なら選んだIDを捨てる（紺の単色）
   */
  private static adjusted(raw: unknown, context: Parameters<typeof DraftProposal.parse>[1]): unknown {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
    const purpose = context.purpose ?? PromptPurpose.PLAN;
    if (purpose.keepsCurrentDraftTraits()) {
      const keep = DraftProposal.requiredKeep(context);
      return { ...raw, backgroundPhotoId: undefined, prCategory: keep.prCategory, sourceUrls: keep.sourceUrls };
    }
    return !purpose.choosesBackgroundPhoto() || context.backgroundPhotoIds?.length === 0 ? { ...raw, backgroundPhotoId: undefined } : raw;
  }

  /** 用途による追加の条件。修正は中のスライドの枚数を保つ。最初の生成は、選んだ背景写真が候補にあること */
  private static purposeViolations(raw: unknown, context: Parameters<typeof DraftProposal.parse>[1]): string[] {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return [];
    const record = raw as Record<string, unknown>;
    const purpose = context.purpose ?? PromptPurpose.PLAN;
    if (purpose.keepsCurrentDraftTraits()) {
      const expected = DraftProposal.requiredKeep(context).bodySlideCount;
      const count = Array.isArray(record.slides) ? record.slides.length : undefined;
      return count !== undefined && count !== expected ? [`中のスライドは${expected}枚にしてください（${count}枚）`] : [];
    }
    const chosen = record.backgroundPhotoId;
    const candidates = context.backgroundPhotoIds;
    return purpose.choosesBackgroundPhoto() && candidates && candidates.length > 0 && typeof chosen === "string" && chosen !== ""
      && !candidates.includes(chosen) ? [`背景写真のIDが候補にありません: ${chosen}`] : [];
  }

  private static requiredKeep(context: Parameters<typeof DraftProposal.parse>[1]): NonNullable<Parameters<typeof DraftProposal.parse>[1]["keep"]> {
    if (!context.keep) throw new Error("修正（REVISE）の検査には、保つもの（keep）が要ります");
    return context.keep;
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
