// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { sampleBody, sampleMaterial, sampleSlides } from "@/domain/__tests__/samples";
import { EMPTY_TEMPLATE_WORK } from "@/lib/template/templateWork";
import { forgetAllAutosaves, ownsPath, scopedKey } from "./autosaveScope";
import { hasTemplateWork, recallTemplateWork, rememberTemplateWork } from "./templateDraftAutosave";

const ME = { tenantId: "t", memberId: "m1" };
const work = (slides = sampleSlides([sampleBody(sampleMaterial())])) => ({ ...EMPTY_TEMPLATE_WORK, ideaText: "ネタ", slides });

describe("端末への一時保存の分け方", () => {
  beforeEach(() => localStorage.clear());

  it("キーに団体IDとメンバーIDを含み、別のメンバー・別の団体には復元されない", () => {
    rememberTemplateWork(ME, work());
    expect(recallTemplateWork(ME)?.ideaText).toBe("ネタ");
    expect(hasTemplateWork({ tenantId: "t", memberId: "m2" })).toBe(false);
    expect(hasTemplateWork({ tenantId: "other", memberId: "m1" })).toBe(false);
    expect(scopedKey("template-draft", ME)).toContain("t:m1");
  });

  it("保存先が自団体の接頭辞でない一時保存は復元しない", () => {
    rememberTemplateWork(ME, work());
    // 団体 t の画像を指す内容が、別の団体 other のキーに入っていたとして復元を試みる
    const other = { tenantId: "other", memberId: "m1" };
    localStorage.setItem(scopedKey("template-draft", other), localStorage.getItem(scopedKey("template-draft", ME))!);
    expect(recallTemplateWork(other)).toBeNull();
  });

  it("復元した素材画像は容量を持つ（保存先→容量の表は無い）", () => {
    rememberTemplateWork(ME, work());
    expect(recallTemplateWork(ME)?.slides?.toStoredForm()[1]).toMatchObject({ material: { byteSize: 120_000 } });
  });

  it("サインアウトで、写真の投稿・AIで作る投稿の一時保存をすべて消す（他のキーは消さない）", () => {
    rememberTemplateWork(ME, work());
    localStorage.setItem(scopedKey("post-draft", ME), "{}");
    localStorage.setItem("niijimaig:new-post-draft", "{}");
    localStorage.setItem("other", "keep");
    forgetAllAutosaves();
    expect(hasTemplateWork(ME)).toBe(false);
    expect(localStorage.getItem(scopedKey("post-draft", ME))).toBeNull();
    expect(localStorage.getItem("niijimaig:new-post-draft")).toBeNull();
    expect(localStorage.getItem("other")).toBe("keep");
    expect(ownsPath(ME, "t/posts/1.jpg")).toBe(true);
    expect(ownsPath(ME, "tx/posts/1.jpg")).toBe(false);
  });
});
