import type { DraftProposal } from "../draft/DraftProposal";
import type { PastPostCover } from "../post/PastPostCover";
import { BodyContent } from "./BodyContent";
import { ClosingContent } from "./ClosingContent";
import { CoverContent } from "./CoverContent";
import { Slide } from "./Slide";
import { SlideRole } from "./SlideRole";

/**
 * スライド構成: テンプレートの投稿のスライドの並び。下書き案と投稿の版が持つ。
 * 表紙1 → 中のスライド1〜8 → 最後のスライド1 の順（合計3〜10枚。Instagram のカルーセル上限10枚。REQ-002 BR-002-11）。
 * 並びと枚数の検査は AI の出力にも、人が中のスライドを足し引きしたときにも同じものをかける。Java の SlideList と揃える
 */
export class SlideList {
  static readonly BODY_MIN = 1;
  static readonly BODY_MAX = 8;

  private constructor(private readonly slides: readonly Slide[]) {}

  /** 役割の並びが満たさない条件（空なら満たす）。AI の出力は中身を作る前の段階でも検査できるよう、役割だけで判断する */
  static violationsOf(roles: readonly SlideRole[]): string[] {
    const middle = roles.slice(1, -1);
    const ordered = roles.length >= 2 && roles[0] === SlideRole.COVER
      && roles[roles.length - 1] === SlideRole.CLOSING && middle.every((r) => r === SlideRole.BODY);
    const bodyCount = roles.filter((r) => r === SlideRole.BODY).length;
    return [
      ...(ordered ? [] : ["スライドは表紙1枚→中のスライド→最後のスライド1枚の順に並べてください"]),
      ...(bodyCount >= SlideList.BODY_MIN && bodyCount <= SlideList.BODY_MAX ? []
        : [`中のスライドは${SlideList.BODY_MIN}〜${SlideList.BODY_MAX}枚にしてください（${bodyCount}枚）`]),
    ];
  }

  static of(slides: readonly Slide[]): SlideList {
    const violations = SlideList.violationsOf(slides.map((s) => s.role));
    if (violations.length > 0) throw new Error(violations.join("\n"));
    return new SlideList([...slides]);
  }

  /** 記録から戻すときは検査しない */
  static restore(slides: readonly Slide[]): SlideList {
    return new SlideList([...slides]);
  }

  /** 下書き案から作る（最初の生成。表紙の背景写真は AI が選んだもの、素材画像はまだ無い） */
  static createFromDraft(draft: DraftProposal, background?: { photoId: string; storagePath: string }): SlideList {
    return SlideList.of([
      Slide.createCover(CoverContent.of(draft.cover, background)),
      ...draft.bodies().map((b) => Slide.createBody(BodyContent.of({ text: b.text, brief: b.brief }))),
      Slide.createClosing(ClosingContent.empty()),
    ]);
  }

  violations(): string[] {
    return SlideList.violationsOf(this.slides.map((s) => s.role));
  }

  items(): readonly Slide[] {
    return this.slides;
  }

  count(): number {
    return this.slides.length;
  }

  bodyCount(): number {
    return this.slides.filter((s) => s.role === SlideRole.BODY).length;
  }

  canAddBody(): boolean {
    return this.bodyCount() < SlideList.BODY_MAX;
  }

  canRemoveBody(): boolean {
    return this.bodyCount() > SlideList.BODY_MIN;
  }

  /** 最後の中のスライドの後ろに中のスライドを足した新しい構成（8枚を超えるなら例外） */
  withBodyAdded(content: BodyContent): SlideList {
    return SlideList.of([...this.slides.slice(0, -1), Slide.createBody(content), ...this.slides.slice(-1)]);
  }

  /** 指定した位置（0始まり）の中のスライドを外した新しい構成（表紙・最後のスライド、または1枚になるなら例外） */
  withoutSlideAt(index: number): SlideList {
    if (this.slides[index]?.role !== SlideRole.BODY) throw new Error("外せるのは中のスライドだけです");
    return SlideList.of(this.slides.filter((_, i) => i !== index));
  }

  /** 指定した位置のスライドを、同じ役割のスライドに差し替えた新しい構成（人の手直し） */
  withSlideReplaced(index: number, slide: Slide): SlideList {
    if (this.slides[index]?.role !== slide.role) throw new Error("同じ役割のスライドにしか差し替えられません");
    return SlideList.of(this.slides.map((s, i) => (i === index ? slide : s)));
  }

  /**
   * 下書き案の文言だけを取り込んだ新しい構成。表紙の背景写真と、同じ順番の中のスライドの素材画像は保つ
   * （修正指示の再生成。REQ-002 BR-002-04）。中のスライドが増えたぶんは素材画像なし、減ったぶんは外れる
   */
  withDraftText(draft: DraftProposal): SlideList {
    const kept = this.slides.flatMap((s) => s.bodyContent() ?? []);
    const bodies = draft.bodies().map((b, i) => Slide.createBody(kept[i]
      ? kept[i].withDraftText(b.text, b.brief) : BodyContent.of({ text: b.text, brief: b.brief })));
    const cover = this.slides[0].coverContent();
    return SlideList.of([
      Slide.createCover(cover ? cover.withText(draft.cover) : CoverContent.of(draft.cover)),
      ...bodies,
      this.slides[this.slides.length - 1],
    ]);
  }

  /** 画像化のとき、承認で選んだ過去の投稿の表紙を最後のスライドに載せた新しい構成 */
  withPastPosts(covers: readonly PastPostCover[]): SlideList {
    return SlideList.of([...this.slides.slice(0, -1), Slide.createClosing(ClosingContent.of(covers))]);
  }

  imageRefs(): readonly string[] {
    return this.slides.flatMap((s) => s.imageRefs());
  }

  /** 写真風の生成画像を含むか（各スライドに委ねる） */
  requiresAiDisclosure(): boolean {
    return this.slides.some((s) => s.requiresAiDisclosure());
  }

  needsApprovalCheck(): boolean {
    return this.slides.some((s) => s.needsApprovalCheck());
  }
}
