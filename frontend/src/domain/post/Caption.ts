import { Hashtag } from "./Hashtag";

const formatCount = (n: number): string => n.toLocaleString("ja-JP");

/**
 * キャプション: 人や AI が書く投稿の本文（ハッシュタグを含んでよい）。2,200文字以下（コードポイントで数える）、ハッシュタグ30個以下。
 * 付記・キャプションの定型・ハッシュタグを足した上限は公開用キャプション（PublishCaption）が確かめる
 */
export class Caption {
  static readonly MAX_LENGTH = 2200;
  static readonly MAX_HASHTAGS = 30;

  private constructor(readonly text: string) {}

  /** 満たさない項目（空なら保存できる）。入力中の表示に使う */
  static violationsOf(text: string): string[] {
    const draft = new Caption(text);
    const violations: string[] = [];
    if (draft.length() > Caption.MAX_LENGTH) {
      violations.push(`キャプションは${formatCount(Caption.MAX_LENGTH)}文字以内です（${formatCount(draft.length())}文字）`);
    }
    if (draft.hashtagCount() > Caption.MAX_HASHTAGS) {
      violations.push(`ハッシュタグは${Caption.MAX_HASHTAGS}個までです（${draft.hashtagCount()}個）`);
    }
    return violations;
  }

  static of(text: string): Caption {
    const violations = Caption.violationsOf(text);
    if (violations.length > 0) throw new Error(violations.join("\n"));
    return new Caption(text);
  }

  /** 記録から戻すときは検査しない（上限を超えた記録が1件あっても、一覧全体を表示できるように。違反は承認依頼の前に出す） */
  static restore(text: string): Caption {
    return new Caption(text);
  }

  length(): number {
    return [...this.text].length;
  }

  remainingLength(): number {
    return Caption.MAX_LENGTH - this.length();
  }

  hashtagCount(): number {
    return Hashtag.countIn(this.text);
  }
}
