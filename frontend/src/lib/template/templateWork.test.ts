import { describe, expect, it } from "vitest";
import { sampleMaterial, sampleSettings, sampleSlides } from "@/domain/__tests__/samples";
import { DraftProposal } from "@/domain/draft/DraftProposal";
import { PrCategory } from "@/domain/post/PrCategory";
import {
  additionalHashtagsOf, EMPTY_TEMPLATE_WORK, isRevision, revisionOf, toDraftContent, withDraft, withMaterial, type TemplateWork,
} from "./templateWork";

const PHOTOS = [{ id: "bg1", storagePath: "t1/backgrounds/1.jpg" }, { id: "bg2", storagePath: "t1/backgrounds/2.jpg" }];
const slideJson = (n: number) => ({
  heading: `見出し${n}`, description: `説明文${n}です。学割が使えます。`, emphases: ["学割"], picturePrompt: "明るいカフェ", needsReplacement: false,
});
const proposal = (over: Record<string, unknown> = {}) => DraftProposal.parse({
  cover: { target: "同志社大学", keyword: "期末試験", annotation: "", closingWords: "まとめたよ", accent: "PURPLE" },
  backgroundPhotoId: "bg2", slides: [slideJson(1), slideJson(2)], caption: "本文", additionalHashtags: ["#学割"], prCategory: "PR", sourceUrls: [], ...over,
}, { settings: sampleSettings(), prLabel: "【PR】\n", sourceUrlRequired: false }).proposal!;

const existing = (): TemplateWork => ({
  ...EMPTY_TEMPLATE_WORK, ideaId: "i-1", generationId: "g-1", captionText: "古い本文", prCategory: PrCategory.NONE,
  slides: sampleSlides(), sourceUrls: [],
});

describe("S-07 の作業中の内容（下書き案の取り込み）", () => {
  it("AC-002-01 最初の生成は、スライドごと置き換え、AI が選んだ背景写真・PR区分を取り込む", () => {
    const work = withDraft(EMPTY_TEMPLATE_WORK, proposal(), { ideaId: "i-1", generationId: "g-1" }, PHOTOS);
    expect(work.slides?.count()).toBe(4);
    expect(work.slides?.items()[0].coverContent()?.background).toEqual({ photoId: "bg2", storagePath: "t1/backgrounds/2.jpg" });
    expect(work).toMatchObject({ generationId: "g-1", ideaId: "i-1", captionText: "本文", hashtagText: "#学割", prCategory: PrCategory.from("PR") });
  });

  it("AC-002-05 修正（parentGenerationId あり）は文言だけ取り込み、素材画像・背景写真・PR区分を保つ", () => {
    const base = existing();
    const withImage = { ...withMaterial(base, 1, sampleMaterial()), prCategory: PrCategory.PR };
    const source = { ideaId: "i-1", generationId: "g-2", parentGenerationId: "g-1" };
    expect(isRevision(withImage, source)).toBe(true);
    const revised = withDraft(withImage, proposal({ prCategory: "NONE" }), source, PHOTOS);
    expect(revised.generationId).toBe("g-2");
    expect(revised.prCategory).toBe(PrCategory.PR);
    expect(revised.slides?.items()[0].coverContent()?.background?.photoId).toBe("bg1");
    expect(revised.slides?.items()[1].bodyContent()?.material?.storagePath).toBe("t/materials/1.jpg");
    expect(revised.slides?.items()[1].bodyContent()?.text.heading).toBe("見出し1");
  });

  it("手動コピペの新規（parentGenerationId なし）は、スライドがあっても置き換える。スライドが無い修正は新規として扱う", () => {
    expect(isRevision(existing(), { ideaId: "i-1", generationId: "g-3" })).toBe(false);
    expect(isRevision(EMPTY_TEMPLATE_WORK, { ideaId: "i-1", generationId: "g-3", parentGenerationId: "g-1" })).toBe(false);
  });
});

describe("S-07 の作業中の内容（素材画像・保存の形）", () => {
  it("素材画像を中のスライドに載せ替える。容量は素材画像が持ち、保存の形にそのまま出る", () => {
    const work = withMaterial(existing(), 1, sampleMaterial("ILLUSTRATION"));
    const stored = toDraftContent({ ...work, slides: work.slides! }).slides.toStoredForm();
    expect(stored[1]).toMatchObject({ material: { storagePath: "t/materials/1.jpg", byteSize: 120_000 } });
  });

  it("中のスライドでない位置には載せない", () => {
    const work = existing();
    expect(withMaterial(work, 0, sampleMaterial()).slides?.imageRefs()).toEqual(work.slides?.imageRefs());
  });

  it("追加のハッシュタグは空白で語に分ける。投稿の版は設定とスライドが揃ったときだけ作る", () => {
    const work = { ...existing(), hashtagText: " #学割  #京都 " };
    expect(additionalHashtagsOf(work)).toEqual(["#学割", "#京都"]);
    expect(revisionOf(work, null)).toBeNull();
    expect(revisionOf(EMPTY_TEMPLATE_WORK, sampleSettings())).toBeNull();
    expect(revisionOf(work, sampleSettings())?.violationsForSaving("【PR】\n")).toEqual([]);
  });
});
