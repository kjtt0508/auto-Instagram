import { FailureKind } from "./FailureKind";

/** 失敗理由: 失敗区分と、人が読める説明 */
export class FailureReason {
  private constructor(
    readonly kind: FailureKind,
    readonly message: string,
  ) {}

  static of(kindCode: string, message: string): FailureReason {
    if (message.trim() === "") throw new Error("失敗理由の説明は必須です");
    return new FailureReason(FailureKind.from(kindCode), message);
  }

  /** 失敗区分の対処方法 */
  guidance(): string {
    return this.kind.guidance;
  }

  /**
   * 説明のあとに画面が足して出す対処方法。説明がすでに対処方法を含む（または付けない）失敗区分は null
   * （画像化の失敗。同じ案内を2回出さない・再実行で直らない失敗に「再実行でやり直せます」を出さない。REQ-007 BR-007-06）
   */
  guidanceToShow(): string | null {
    return this.kind.describesOwnGuidance() ? null : this.kind.guidance;
  }
}
