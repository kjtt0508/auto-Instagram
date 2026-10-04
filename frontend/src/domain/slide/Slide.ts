import { BodyContent } from "./BodyContent";
import { ClosingContent } from "./ClosingContent";
import { CoverContent } from "./CoverContent";
import { SlideRole } from "./SlideRole";

/**
 * スライド: 投稿画像1枚分の内容。スライド役割と、その役割の中身（表紙の中身・中のスライドの中身・最後のスライドの中身のどれか）の組。
 * 役割と中身の型は、作り方で必ず合う。Java の Slide と揃える
 */
export class Slide {
  private constructor(
    readonly role: SlideRole,
    private readonly content: CoverContent | BodyContent | ClosingContent,
  ) {}

  static createCover(content: CoverContent): Slide {
    return new Slide(SlideRole.COVER, content);
  }

  static createBody(content: BodyContent): Slide {
    return new Slide(SlideRole.BODY, content);
  }

  static createClosing(content: ClosingContent): Slide {
    return new Slide(SlideRole.CLOSING, content);
  }

  /** 表紙の中身（表紙でなければ undefined） */
  coverContent(): CoverContent | undefined {
    return this.content instanceof CoverContent ? this.content : undefined;
  }

  bodyContent(): BodyContent | undefined {
    return this.content instanceof BodyContent ? this.content : undefined;
  }

  closingContent(): ClosingContent | undefined {
    return this.content instanceof ClosingContent ? this.content : undefined;
  }

  /** 画像化に必要な画像の参照（保存先）の一覧。実際にあるかは画像化の側で確かめ、無ければ画像化の失敗 */
  imageRefs(): readonly string[] {
    return this.content.imageRefs();
  }

  /** 写真風の生成画像を含むか（中身に委ねる） */
  requiresAiDisclosure(): boolean {
    return this.content.requiresAiDisclosure();
  }

  needsApprovalCheck(): boolean {
    return this.content.needsApprovalCheck();
  }
}
