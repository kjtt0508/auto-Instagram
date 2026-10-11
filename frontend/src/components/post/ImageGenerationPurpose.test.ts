import { describe, expect, it } from "vitest";
import { ImageGenerationError } from "@/lib/api/imageGenerationApi";
import { BackgroundPhotoApiError } from "@/lib/api/backgroundPhotoApi";
import { explainFailure, ImageGenerationPurpose } from "./ImageGenerationPurpose";

// S-13 の用途ごとの設定の表（REQ-006 設計 3章）。画面部品の中に用途の分岐を散らさないための表なので、表の中身を確かめる

const { POST_IMAGE, MATERIAL_IMAGE, COVER_BACKGROUND } = ImageGenerationPurpose;

describe("AC-006-06 表紙の背景は画像の種類が「背景・イラスト」だけで、写真風は無い", () => {
  it("表紙の背景の選べる画像の種類は ILLUSTRATION の1つだけ（固定の表示になる）", () => {
    expect(COVER_BACKGROUND.styles.map((s) => s.code)).toEqual(["ILLUSTRATION"]);
    expect(COVER_BACKGROUND.styles[0].label).toBe("背景・イラスト");
  });

  it("投稿画像と素材画像は、これまでどおり背景・イラストと写真風から選べる", () => {
    for (const purpose of [POST_IMAGE, MATERIAL_IMAGE]) {
      expect(purpose.styles.map((s) => s.code)).toEqual(["ILLUSTRATION", "PHOTOREALISTIC"]);
    }
  });
});

describe("AC-006-04 用途ごとの設定", () => {
  it("選べる枚数: 表紙の背景は1枚、素材画像は1枚、投稿画像は空き枠の分", () => {
    expect(COVER_BACKGROUND.maxChoices(3)).toBe(1);
    expect(MATERIAL_IMAGE.maxChoices(3)).toBe(1);
    expect(POST_IMAGE.maxChoices(3)).toBe(3);
  });

  it("確定ボタンの名前: 背景は「この背景を使う」、ほかは選んだ枚数つきの「選んだ画像を使う」（既存の文言のまま）", () => {
    expect(COVER_BACKGROUND.confirmLabel(0)).toBe("この背景を使う");
    expect(COVER_BACKGROUND.confirmLabel(1)).toBe("この背景を使う");
    expect(POST_IMAGE.confirmLabel(0)).toBe("選んだ画像を使う");
    expect(POST_IMAGE.confirmLabel(2)).toBe("選んだ画像を使う（2）");
    expect(MATERIAL_IMAGE.confirmLabel(1)).toBe("選んだ画像を使う（1）");
  });

  it("画像のバイト列が要るのは投稿画像と素材画像。背景は要らない（サーバーが複製する）", () => {
    expect(POST_IMAGE.needsImageBytes).toBe(true);
    expect(MATERIAL_IMAGE.needsImageBytes).toBe(true);
    expect(COVER_BACKGROUND.needsImageBytes).toBe(false);
  });

  it("説明文の欄があるのは背景だけ。初めの値は指示の文（改行を空白にまとめ、100文字に切る）", () => {
    expect(POST_IMAGE.description).toBeNull();
    expect(MATERIAL_IMAGE.description).toBeNull();
    const field = COVER_BACKGROUND.description!;
    expect(field.initialValue("夕暮れの京都御苑、やわらかい光")).toBe("夕暮れの京都御苑、やわらかい光");
    expect(field.initialValue("夕暮れの京都御苑\n  やわらかい光")).toBe("夕暮れの京都御苑 やわらかい光");
    expect([...field.initialValue("あ".repeat(101))]).toHaveLength(100);
  });

  it("説明文は1〜100文字・改行なし。満たさなければ理由が返る", () => {
    const { violationsOf } = COVER_BACKGROUND.description!;
    expect(violationsOf("夕暮れ")).toEqual([]);
    expect(violationsOf("あ".repeat(100))).toEqual([]);
    expect(violationsOf("")).toHaveLength(1);
    expect(violationsOf("   ")).toHaveLength(1);
    expect(violationsOf("あ".repeat(101))).toEqual(["説明文は100文字までです（101文字）"]);
    expect(violationsOf("夕暮れ\n京都")).toEqual(["説明文に改行や制御文字は入れられません"]);
  });
});

describe("AC-006-08 エラーコードから用途ごとの案内への読み替え", () => {
  const BACKGROUND_LIMIT = "今日の画像生成は上限に達しました。登録した背景写真から選んでください";
  const UNAVAILABLE = "いまは背景を作れません。登録した背景写真から選んでください";
  const server = (code: string) => new ImageGenerationError("サーバーの文言", code);

  it("背景: 上限は「登録した背景写真から選んでください」の案内（回数が上限のときの表示も同じ）", () => {
    expect(explainFailure(COVER_BACKGROUND, server("IMAGE_LIMIT_REACHED"))).toBe(BACKGROUND_LIMIT);
    expect(COVER_BACKGROUND.usageLimitNotice).toBe(BACKGROUND_LIMIT);
  });

  it("背景: 英訳できない・提供元の失敗・時間切れは「いまは背景を作れません」", () => {
    for (const code of ["TRANSLATION_UNAVAILABLE", "GENERATION_FAILED", "GENERATION_TIMEOUT"]) {
      expect(explainFailure(COVER_BACKGROUND, server(code))).toBe(UNAVAILABLE);
    }
  });

  it("AC-006-07 背景: 背景写真が30枚・候補の期限切れ（背景写真にするときのエラー）", () => {
    const adoption = (code: string) => new BackgroundPhotoApiError("サーバーの文言", code);
    expect(explainFailure(COVER_BACKGROUND, adoption("BACKGROUND_LIMIT_REACHED"))).toBe("背景写真が30枚です。管理者が使わない写真を整理してください");
    expect(explainFailure(COVER_BACKGROUND, adoption("CANDIDATE_GONE"))).toBe("候補の期限が切れました。作り直してください");
  });

  it("表にないコード（指示の拒否など）やコードのないエラーは、エラー自身の文言を出す", () => {
    expect(explainFailure(COVER_BACKGROUND, server("INVALID_PROMPT"))).toBe("サーバーの文言");
    expect(explainFailure(COVER_BACKGROUND, new Error("候補の期限が切れました。作り直してください"))).toBe("候補の期限が切れました。作り直してください");
    expect(explainFailure(COVER_BACKGROUND, server("constructor"))).toBe("サーバーの文言");   // 表の見かけの項目（Object の持ち物）は読み替えない
    expect(explainFailure(COVER_BACKGROUND, "文字列")).toBe("処理に失敗しました。時間を置いてお試しください");
  });

  it("投稿画像・素材画像の文言は変えない（サーバーの文言をそのまま出す。案内は「写真を撮る・選ぶ」）", () => {
    for (const purpose of [POST_IMAGE, MATERIAL_IMAGE]) {
      expect(explainFailure(purpose, server("IMAGE_LIMIT_REACHED"))).toBe("サーバーの文言");
      expect(explainFailure(purpose, server("TRANSLATION_UNAVAILABLE"))).toBe("サーバーの文言");
      expect(purpose.usageLimitNotice).toBe("今日の画像生成は上限に達しました。写真を撮る・選ぶで続けてください");
    }
  });
});
