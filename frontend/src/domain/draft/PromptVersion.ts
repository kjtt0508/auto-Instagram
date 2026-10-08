import type { GenerationInput } from "./GenerationInput";
import type { PromptPurpose } from "./PromptPurpose";

/**
 * プロンプト版: 用途ごとのプロンプト本文の1つの版（本文は変更しない。変えるときは新しい版を作る）。
 * 生成の入力から作った値を `{{名前}}` の位置に差し込む
 */
export class PromptVersion {
  private constructor(
    readonly id: string,
    readonly purpose: PromptPurpose,
    readonly versionNo: number,
    private readonly body: string,
  ) {}

  /** 記録から戻す（版の作成時に差し込み値の検査は済んでいる） */
  static restore(parts: { id: string; purpose: PromptPurpose; versionNo: number; body: string }): PromptVersion {
    return new PromptVersion(parts.id, parts.purpose, parts.versionNo, parts.body);
  }

  /**
   * 入力の値を差し込んだプロンプト。置き換えは1回の走査で行い、差し込んだ値の中の `{{…}}` は置き換えない
   * （ネタの本文に `{{instruction}}` と書かれていても、別の値にならない）。入力に無い名前はそのまま残す
   */
  render(input: GenerationInput): string {
    const values = input.placeholders();
    return this.body.replace(/\{\{(\w+)\}\}/gu, (whole, name: string) => (Object.hasOwn(values, name) ? values[name] : whole));
  }
}
