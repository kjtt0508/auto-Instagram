import { AiDisclosure } from "./AiDisclosure";
import { Caption } from "./Caption";
import type { CaptionFooter } from "./CaptionFooter";
import { Hashtag } from "./Hashtag";

const formatCount = (n: number): string => n.toLocaleString("ja-JP");

/**
 * 公開用キャプション: Instagram に公開する文。組み立てはここ1か所だけ:
 * PR表記（PR案件のみ）→ キャプション → AI生成の表示（要るときのみ）→ キャプションの定型（テンプレートの投稿のみ）→
 * ハッシュタグ（固定＋追加。テンプレートの投稿のみ。1行に1つ）。2,200文字以下・ハッシュタグ30個以下。
 * Java の PublishCaption と揃える（docs/model/fixtures/caption.json）
 */
export class PublishCaption {
  /** 定型・ハッシュタグの前に空行を1つ入れる */
  static readonly SECTION_SEPARATOR = "\n\n";
  static readonly HASHTAG_SEPARATOR = "\n";
  private static readonly PR_NAME = "PR表記";
  private static readonly TEMPLATE_PARTS_NAME = "キャプションの定型とハッシュタグ";

  private constructor(
    readonly text: string,
    private readonly captionLength: number,
    private readonly noticeNames: readonly string[],
    private readonly hasTemplateParts: boolean,
  ) {}

  /** 組み立てる。上限を超えていても作る（理由は violations() で返す。入力中の表示や生成の検査に使う） */
  static restore(parts: {
    prefix: string; caption: Caption; disclosure: AiDisclosure; footer?: CaptionFooter; hashtags?: readonly string[];
  }): PublishCaption {
    const hashtags = parts.hashtags ?? [];
    const footerPart = parts.footer ? PublishCaption.SECTION_SEPARATOR + parts.footer.text : "";
    const hashtagPart = hashtags.length > 0 ? PublishCaption.SECTION_SEPARATOR + hashtags.join(PublishCaption.HASHTAG_SEPARATOR) : "";
    // 違反の説明に名前を出すのはPR表記とAI生成の表示だけ。定型とハッシュタグは名前に出さず、文字数には数える
    const names = [
      ...(parts.prefix ? [PublishCaption.PR_NAME] : []),
      ...(parts.disclosure.isRequired() ? [AiDisclosure.NAME] : []),
    ];
    const text = parts.prefix + parts.caption.text + parts.disclosure.suffix() + footerPart + hashtagPart;
    return new PublishCaption(text, parts.caption.length(), names, parts.footer !== undefined || hashtags.length > 0);
  }

  /** 組み立てる。上限を超えるなら例外（公開用キャプションは上限を守る） */
  static of(parts: Parameters<typeof PublishCaption.restore>[0]): PublishCaption {
    const assembled = PublishCaption.restore(parts);
    const violations = assembled.violations();
    if (violations.length > 0) throw new Error(violations.join("\n"));
    return assembled;
  }

  length(): number {
    return [...this.text].length;
  }

  hashtagCount(): number {
    return Hashtag.countIn(this.text);
  }

  /** キャプションに使える残りの文字数（付記・定型・ハッシュタグを除いた分。負なら付記だけで上限を超えている） */
  remainingForCaption(): number {
    return Caption.MAX_LENGTH - (this.length() - this.captionLength);
  }

  /** 満たさない項目。文字数の超過には、付けたものの名前（PR表記・AI生成の表示・キャプションの定型・ハッシュタグ）と文字数を添える */
  violations(): string[] {
    const violations: string[] = [];
    if (this.length() > Caption.MAX_LENGTH) violations.push(this.lengthViolation());
    if (this.hashtagCount() > Caption.MAX_HASHTAGS) {
      violations.push(`ハッシュタグは${Caption.MAX_HASHTAGS}個までです（${this.hashtagCount()}個）`);
    }
    return violations;
  }

  private lengthViolation(): string {
    const limit = formatCount(Caption.MAX_LENGTH);
    const count = formatCount(this.length());
    if (this.noticeNames.length > 0) return `${this.noticeNames.join("と")}を含めて${limit}文字以内にしてください（${count}文字）`;
    if (this.hasTemplateParts) return `${PublishCaption.TEMPLATE_PARTS_NAME}を含めて${limit}文字以内にしてください（${count}文字）`;
    return `キャプションは${limit}文字以内です（${count}文字）`;
  }
}
