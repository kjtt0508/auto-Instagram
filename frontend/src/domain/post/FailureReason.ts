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

  /** 画面に出す対処方法 */
  guidance(): string {
    return this.kind.guidance;
  }
}
