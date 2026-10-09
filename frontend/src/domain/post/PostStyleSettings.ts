import type { CaptionFooter } from "./CaptionFooter";
import type { FixedHashtags } from "./FixedHashtags";
import { Hashtag } from "./Hashtag";

/**
 * 投稿の型の設定: 団体ごとの投稿の型の固定の文言・候補（上端の帯の文言・表紙の対象の候補・最後のスライドの定型文・
 * アカウントの紹介・キャプションの定型・固定ハッシュタグ・ロゴ）。AI は書き換えない。版で管理し、版は変更しない。Java の PostStyleSettings と揃える
 */
export class PostStyleSettings {
  private constructor(
    readonly tenantId: string,
    readonly version: number,
    readonly bandText: string,
    private readonly targets: readonly string[],
    readonly closingMessage: string,
    readonly accountIntroduction: string,
    private readonly footer: CaptionFooter,
    private readonly hashtags: FixedHashtags,
    readonly logoStoragePath: string | undefined,
  ) {}

  static of(parts: {
    tenantId: string; version: number; bandText: string; coverTargets: readonly string[]; closingMessage: string;
    accountIntroduction: string; captionFooter: CaptionFooter; fixedHashtags: FixedHashtags; logoStoragePath?: string;
  }): PostStyleSettings {
    if (parts.tenantId === "") throw new Error("団体IDは必須です");
    if (!Number.isInteger(parts.version) || parts.version < 1) throw new Error(`版は1以上です: ${parts.version}`);
    if (parts.coverTargets.length < 1) throw new Error("表紙の対象の候補は1件以上必要です");
    return new PostStyleSettings(parts.tenantId, parts.version, parts.bandText, [...parts.coverTargets],
      parts.closingMessage, parts.accountIntroduction, parts.captionFooter, parts.fixedHashtags, parts.logoStoragePath);
  }

  /**
   * 管理者が入力した新しい版が満たさない条件（欄ごと）。表紙の対象の候補は1件以上・キャプションの定型は空でない・
   * 固定ハッシュタグはハッシュタグの形。上端の帯の文言・最後のスライドの定型文・アカウントの紹介は空でもよい
   */
  static violationsOfInput(input: { coverTargets: readonly string[]; captionFooter: string; fixedHashtags: readonly string[] }): {
    coverTargets: string[]; captionFooter: string[]; fixedHashtags: string[];
  } {
    return {
      coverTargets: input.coverTargets.length < 1 ? ["表紙の対象の候補を1件以上入れてください"] : [],
      captionFooter: input.captionFooter.trim() === "" ? ["キャプションの定型は空にできません"] : [],
      fixedHashtags: input.fixedHashtags.filter((t) => !Hashtag.parse(t)).map((t) => `ハッシュタグの形が正しくありません: ${t}`),
    };
  }

  /** テンプレートに渡す固定の文言（ロゴは保存先を参照名にする） */
  renderValues() {
    return { bandText: this.bandText, closingMessage: this.closingMessage, accountIntroduction: this.accountIntroduction,
      logo: this.logoStoragePath };
  }

  /** 表紙の対象の候補に含まれるか */
  acceptsCoverTarget(target: string): boolean {
    return this.targets.includes(target);
  }

  coverTargets(): readonly string[] {
    return this.targets;
  }

  captionFooter(): CaptionFooter {
    return this.footer;
  }

  fixedHashtags(): FixedHashtags {
    return this.hashtags;
  }
}
