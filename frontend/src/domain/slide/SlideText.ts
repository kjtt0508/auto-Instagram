import { lengthViolations } from "./lengthViolations";

/**
 * スライドの文言: 中のスライドに描く見出し（1〜16文字）・説明文（1〜120文字）と、説明文の中で赤字にする強調する語（0〜3か所）。
 * 強調する語は説明文に含まれる部分文字列で、互いに重ならない（REQ-002 BR-002-13）。
 * 同じ語が説明文に複数あるときは、前の強調する語と重ならない最初の位置に当てはめる。
 * Java の SlideText と揃える（docs/model/fixtures/slide-text.json）
 */
export class SlideText {
  static readonly HEADING_MAX = 16;
  static readonly DESCRIPTION_MAX = 120;
  static readonly EMPHASES_MAX = 3;

  private constructor(
    readonly heading: string,
    readonly description: string,
    readonly emphases: readonly string[],
  ) {}

  /** 満たさない条件（空なら受け付けられる）。AI の出力にも人の書き換えにも同じ検査をかける */
  static violationsOf(parts: { heading: string; description: string; emphases: readonly string[] }): string[] {
    return Object.values(SlideText.violationsByField(parts)).flat();
  }

  /** 満たさない条件を欄ごとに分けたもの（入力欄の下に出す。順番は violationsOf と同じ） */
  static violationsByField(parts: { heading: string; description: string; emphases: readonly string[] }) {
    const placement = SlideText.place(parts.description, parts.emphases);
    return {
      heading: lengthViolations("見出し", parts.heading, 1, SlideText.HEADING_MAX),
      description: lengthViolations("説明文", parts.description, 1, SlideText.DESCRIPTION_MAX),
      emphases: [
        ...(parts.emphases.length > SlideText.EMPHASES_MAX
          ? [`強調する語は${SlideText.EMPHASES_MAX}か所までです（${parts.emphases.length}か所）`] : []),
        ...placement.empty.map(() => "強調する語は空にできません"),
        ...placement.missing.map((w) => `強調する語「${w}」が説明文にありません`),
        ...placement.overlapping.map((w) => `強調する語「${w}」が他の強調する語と重なっています`),
      ],
    };
  }

  /** この文言が満たさない条件を欄ごとに分けたもの（記録から戻した文言・人が書き換え中の文言を検査する） */
  violationsByField() {
    return SlideText.violationsByField(this);
  }

  /** この文言が満たさない条件（空なら承認を依頼できる） */
  violations(): string[] {
    return SlideText.violationsOf(this);
  }

  /** 検査して作る。満たさなければ例外（人の入力を保存するとき） */
  static of(parts: { heading: string; description: string; emphases: readonly string[] }): SlideText {
    const violations = SlideText.violationsOf(parts);
    if (violations.length > 0) throw new Error(violations.join("\n"));
    return SlideText.restore(parts);
  }

  /** 記録から戻すときは検査しない */
  static restore(parts: { heading: string; description: string; emphases: readonly string[] }): SlideText {
    return new SlideText(parts.heading, parts.description, [...parts.emphases]);
  }

  /** 説明文を、強調する部分とそれ以外に分けた並び（テンプレートが強調する部分を赤字に描く） */
  segments(): { text: string; emphasized: boolean }[] {
    const ranges = [...SlideText.place(this.description, this.emphases).ranges].sort((a, b) => a.start - b.start);
    const segments: { text: string; emphasized: boolean }[] = [];
    let cursor = 0;
    for (const range of ranges) {
      if (range.start > cursor) segments.push({ text: this.description.slice(cursor, range.start), emphasized: false });
      segments.push({ text: this.description.slice(range.start, range.end), emphasized: true });
      cursor = range.end;
    }
    if (cursor < this.description.length) segments.push({ text: this.description.slice(cursor), emphasized: false });
    return segments;
  }

  /**
   * 強調する語の当てはめ結果（語の並びの順）。位置と長さはコードポイントで数える（保存と描画が使う。UTF-16 の位置は外に出さない）。
   * 当てはめられない語は含まない（検査 violationsOf が別に出す）
   */
  emphasisRanges(): { start: number; length: number }[] {
    const count = (text: string) => [...text].length;
    return SlideText.place(this.description, this.emphases).ranges.map((r) => ({
      start: count(this.description.slice(0, r.start)), length: count(this.description.slice(r.start, r.end)),
    }));
  }

  /** 強調する語を説明文の中の位置に当てはめる。当てはめられない語は、説明文に無いものと、重なるものに分けて返す */
  private static place(description: string, words: readonly string[]) {
    const ranges: { start: number; end: number }[] = [];
    const result = { ranges, empty: [] as string[], missing: [] as string[], overlapping: [] as string[] };
    for (const word of words) {
      if (word === "") { result.empty.push(word); continue; }
      const found = SlideText.occurrences(description, word);
      const free = found.find((r) => ranges.every((p) => r.end <= p.start || p.end <= r.start));
      if (free) ranges.push(free);
      else (found.length === 0 ? result.missing : result.overlapping).push(word);
    }
    return result;
  }

  private static occurrences(description: string, word: string): { start: number; end: number }[] {
    const found: { start: number; end: number }[] = [];
    for (let at = description.indexOf(word); at >= 0; at = description.indexOf(word, at + 1)) {
      found.push({ start: at, end: at + word.length });
    }
    return found;
  }
}
