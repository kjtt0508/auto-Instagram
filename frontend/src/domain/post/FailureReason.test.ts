import { describe, expect, it } from "vitest";
import { FailureKind } from "./FailureKind";
import { FailureReason } from "./FailureReason";

const MISSING_IMAGE = "最後のスライドの画像が見つかりません。管理者が画像を設定し直したあと、下書きに戻して保存し直してください";

describe("失敗理由が画面に足して出す対処方法", () => {
  it("AC-007-13 画像化の失敗は、説明のあとに対処方法を足さない（最後のスライドの画像が無い失敗に「再実行でやり直せます」を出さない）", () => {
    expect(FailureReason.of("RENDER_FAILED", MISSING_IMAGE).guidanceToShow()).toBeNull();
  });

  it("AC-007-13 再実行で直る画像化の失敗は、説明がすでに対処方法を含むので足さない（同じ案内を2回出さない）", () => {
    const reason = FailureReason.of("RENDER_FAILED", `${FailureKind.RENDER_FAILED.guidance}（背景の画像化に失敗）`);
    expect(reason.guidanceToShow()).toBeNull();
  });

  it("画像化の失敗以外の失敗区分は、失敗区分の対処方法を足して出す", () => {
    const others = FailureKind.all().filter((k) => k !== FailureKind.RENDER_FAILED);
    for (const kind of others) {
      expect(FailureReason.of(kind.code, "詳細").guidanceToShow(), kind.code).toBe(kind.guidance);
    }
  });

  it("失敗区分の対処方法そのものは変わらない（再実行ボタンの出し分けとは別）", () => {
    expect(FailureReason.of("RENDER_FAILED", MISSING_IMAGE).guidance()).toBe("画像化に失敗しました。今すぐ再実行でやり直せます");
    expect(FailureKind.RENDER_FAILED.describesOwnGuidance()).toBe(true);
    expect(FailureKind.TOKEN_INVALID.describesOwnGuidance()).toBe(false);
  });
});
