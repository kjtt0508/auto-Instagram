/**
 * スライド役割: カルーセル内でのスライドの役割（表紙 / 中のスライド / 最後のスライド）。役割ごとに使うテンプレートと中身の型が決まる。
 * 並びは 表紙 → 中のスライド → 最後のスライド。Java の SlideRole と揃える
 */
export class SlideRole {
  static readonly COVER = new SlideRole("COVER", "表紙", "cover", 1);
  static readonly BODY = new SlideRole("BODY", "中のスライド", "body", 2);
  static readonly CLOSING = new SlideRole("CLOSING", "最後のスライド", "closing", 3);

  private constructor(
    readonly code: string,
    readonly label: string,
    private readonly template: string,
    private readonly order: number,
  ) {}

  static all(): readonly SlideRole[] {
    return [SlideRole.COVER, SlideRole.BODY, SlideRole.CLOSING];
  }

  static from(code: string): SlideRole {
    const found = SlideRole.all().find((r) => r.code === code);
    if (!found) throw new Error(`知らないスライド役割です: ${code}`);
    return found;
  }

  /** 使うテンプレートの名前（テンプレートの版の中の、役割ごとの描き方） */
  templateName(): string {
    return this.template;
  }

  /** 並び順で、この役割が other より前か */
  comesBefore(other: SlideRole): boolean {
    return this.order < other.order;
  }
}
