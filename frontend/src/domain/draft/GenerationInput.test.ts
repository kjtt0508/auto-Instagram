import { describe, expect, it } from "vitest";
import { GenerationInput } from "./GenerationInput";
import { PromptPurpose } from "./PromptPurpose";
import { PromptVersion } from "./PromptVersion";
import { RevisionInstruction } from "./RevisionInstruction";

const plan = (ideaText = "・11月3日に学割が始まる", photos: { id: string; description: string }[] = []) =>
  GenerationInput.forPlan({ ideaText, today: "2026-10-05", coverTargets: ["同志社大学", "同志社大生"], backgroundPhotos: photos });

const revision = () => GenerationInput.forRevision({
  ideaText: "・学割", today: "2026-10-05", coverTargets: ["同志社大学"], instruction: RevisionInstruction.of("もっとくだけた感じで"),
  currentDraft: { caption: "本文" }, bodySlideCount: 3,
});

const version = (purpose: PromptPurpose, body: string) => PromptVersion.restore({ id: "v1", purpose, versionNo: 1, body });

describe("生成の入力", () => {
  it("AC-002-03 PLAN の差し込み値は 今日・ネタ・対象の候補・色の候補・背景写真の候補・上限 になる", () => {
    const values = plan("・学割", [{ id: "bg1", description: "正門" }, { id: "bg2", description: "図書館" }]).placeholders();
    expect(values).toMatchObject({
      today: "2026-10-05", ideaText: "・学割", coverTargets: "同志社大学、同志社大生",
      accentColors: "PURPLE（紫）、RED（赤）、TEAL（青緑）", backgroundPhotos: "bg1: 正門\nbg2: 図書館",
    });
    expect(Object.keys(values)).not.toContain("currentDraft");
  });

  it("背景写真の候補が 0枚なら「なし」になる", () => {
    expect(plan().placeholders().backgroundPhotos).toBe("なし");
  });

  it("上限の言い方はドメインの定数から作る（キーワード12文字・添え書き16文字・締めの言葉8文字 …）", () => {
    expect(GenerationInput.limitsText()).toBe(
      "キーワード12文字、添え書き16文字、締めの言葉8文字、見出し16文字、説明文120文字、強調する語3か所まで、中のスライド1〜8枚、追加のハッシュタグ5個まで");
    expect(plan().placeholders().limits).toBe(GenerationInput.limitsText());
  });

  it("AC-002-05 REVISE の差し込み値は 現在の下書き・修正指示・中のスライドの枚数 を持ち、背景写真は持たない", () => {
    const values = revision().placeholders();
    expect(values).toMatchObject({ instruction: "もっとくだけた感じで", bodySlideCount: "3" });
    expect(JSON.parse(values.currentDraft)).toEqual({ caption: "本文" });
    expect(Object.keys(values)).not.toContain("backgroundPhotos");
    expect(revision().bodySlideCount()).toBe(3);
  });

  it("AC-002-09 シリアライズした入力に、入稿者連絡先などの個人情報の欄が無い", () => {
    const json = JSON.stringify([plan().toJson(), revision().toJson()]);
    for (const forbidden of ["contact", "Contact", "email", "mail", "submitter", "phone", "連絡先", "担当者"]) {
      expect(json).not.toContain(forbidden);
    }
  });

  it("ネタが空・日付の形が違う入力は作れない", () => {
    expect(() => plan("  ")).toThrow();
    expect(() => GenerationInput.forPlan({ ideaText: "x", today: "10/5", coverTargets: ["a"], backgroundPhotos: [] })).toThrow();
  });

  it("中のスライドの枚数が 0 や 9 の修正は作れない", () => {
    const make = (bodySlideCount: number) => GenerationInput.forRevision({ ideaText: "x", today: "2026-10-05", coverTargets: ["a"],
      instruction: RevisionInstruction.of("直して"), currentDraft: {}, bodySlideCount });
    expect(() => make(0)).toThrow();
    expect(() => make(9)).toThrow();
  });
});

describe("プロンプト版の差し込み", () => {
  it("AC-002-03 {{名前}} を入力の値に置き換える", () => {
    const rendered = version(PromptPurpose.PLAN, "今日は{{today}}。ネタ: {{ideaText}}／{{coverTargets}}").render(plan("・学割"));
    expect(rendered).toBe("今日は2026-10-05。ネタ: ・学割／同志社大学、同志社大生");
  });

  it("差し込んだ値の中の {{…}} は置き換えない（1回の走査）", () => {
    const rendered = version(PromptPurpose.PLAN, "{{ideaText}} / {{today}}").render(plan("・{{today}} と書かれたメモ $& $1"));
    expect(rendered).toBe("・{{today}} と書かれたメモ $& $1 / 2026-10-05");
  });

  it("入力に無い名前はそのまま残す", () => {
    expect(version(PromptPurpose.PLAN, "{{unknown}} {{toString}}").render(plan())).toBe("{{unknown}} {{toString}}");
  });
});

describe("プロンプト用途の出力スキーマ", () => {
  const slidesOf = (schema: Record<string, unknown>) => (schema.properties as Record<string, Record<string, unknown>>).slides;

  it("PLAN は中のスライド 1〜8枚、REVISE は入力の枚数に固定する", () => {
    expect(slidesOf(PromptPurpose.PLAN.outputSchema())).toMatchObject({ minItems: 1, maxItems: 8 });
    expect(slidesOf(PromptPurpose.REVISE.outputSchema({ bodySlideCount: 4 }))).toMatchObject({ minItems: 4, maxItems: 4 });
  });

  it("REVISE に枚数が無い・範囲外、CAPTION は作れない", () => {
    expect(() => PromptPurpose.REVISE.outputSchema()).toThrow();
    expect(() => PromptPurpose.REVISE.outputSchema({ bodySlideCount: 9 })).toThrow();
    expect(() => PromptPurpose.CAPTION.outputSchema()).toThrow();
  });
});
