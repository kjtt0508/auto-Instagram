import { describe, expect, it } from "vitest";
import { SAMPLE_TEMPLATE_VERSION, sampleBody, sampleCoverText, sampleMaterial, sampleSettings, sampleSlides } from "../__tests__/samples";
import { ClosingContent } from "../slide/ClosingContent";
import { CoverContent } from "../slide/CoverContent";
import { Slide } from "../slide/Slide";
import { SlideList } from "../slide/SlideList";
import { AiDisclosure } from "./AiDisclosure";
import { Caption } from "./Caption";
import { GeneratedImage } from "./GeneratedImage";
import { PostMedia } from "./PostMedia";
import { PostMediaList } from "./PostMediaList";
import { PostRevision } from "./PostRevision";
import { PrCategory } from "./PrCategory";

const PR_LABEL = "【PR】\n";
const photos = (styleCode?: string) => PostMediaList.of([PostMedia.of({
  position: 1, storagePath: "t/posts/1.jpg", width: 1080, height: 1350, bytes: 1,
  generated: styleCode ? GeneratedImage.of({ generationId: "g1", candidatePosition: 1, styleCode }) : null,
})]);
const photoRevision = (styleCode?: string) => PostRevision.ofPhotos({ caption: Caption.of("本文"), prCategory: PrCategory.NONE, media: photos(styleCode) });
const templateRevision = (bodies = [sampleBody()], additionalHashtags: string[] = []) => PostRevision.ofSlides({
  caption: Caption.of("本文"), prCategory: PrCategory.NONE, slides: sampleSlides(bodies), templateVersion: SAMPLE_TEMPLATE_VERSION,
  settings: sampleSettings(), additionalHashtags });

describe("投稿の版とAI生成の表示", () => {
  it("AC-005-04 投稿画像一覧に写真風の生成画像を含む版にはAI生成の表示が要る。背景・イラストや撮った写真には要らない", () => {
    expect([photoRevision("PHOTOREALISTIC").aiDisclosure().isRequired(), photoRevision("PHOTOREALISTIC").needsApprovalCheck()]).toEqual([true, true]);
    expect([photoRevision("ILLUSTRATION").aiDisclosure().isRequired(), photoRevision("ILLUSTRATION").needsApprovalCheck()]).toEqual([false, false]);
    expect(photoRevision().aiDisclosure().isRequired()).toBe(false);
  });

  it("AC-002-19 スライド構成の素材画像に写真風の生成画像を含む版にも、AI生成の表示と承認時の確認が要る", () => {
    const revision = templateRevision([sampleBody(), sampleBody(sampleMaterial("PHOTOREALISTIC"))]);
    expect([revision.aiDisclosure().isRequired(), revision.needsApprovalCheck()]).toEqual([true, true]);
    expect(revision.aiDisclosure().suffix()).toBe(`${AiDisclosure.SEPARATOR}${AiDisclosure.TEXT}`);
    expect(revision.publishCaption(PR_LABEL).text).toContain(AiDisclosure.TEXT);
  });

  it("AC-002-14 人が差し替えた素材画像・背景・イラストの生成画像だけなら、AI生成の表示は付かない", () => {
    for (const material of [sampleMaterial(), sampleMaterial("ILLUSTRATION")]) {
      const revision = templateRevision([sampleBody(material)]);
      expect([revision.aiDisclosure().isRequired(), revision.needsApprovalCheck()]).toEqual([false, false]);
      expect(revision.publishCaption(PR_LABEL).text).not.toContain(AiDisclosure.TEXT);
    }
  });

  it("BR-002-16 生成の時点では、写真風を含むか分からないので、常に付く前提で見込める", () => {
    expect(AiDisclosure.assumingRequired().suffix()).toBe(`${AiDisclosure.SEPARATOR}${AiDisclosure.TEXT}`);
    expect([...AiDisclosure.assumingRequired().suffix()]).toHaveLength(18);
  });
});

describe("投稿の版（テンプレートの投稿）", () => {
  it("AC-002-02 画像化に必要な画像の参照は、背景写真・素材画像（と設定のロゴ）。過去の投稿の表紙は含まない", () => {
    const revision = templateRevision([sampleBody(sampleMaterial("ILLUSTRATION"))]);
    expect(revision.imageRefs()).toEqual(["t/backgrounds/1.jpg", "t/materials/1.jpg"]);
    expect(sampleSlides().items().at(-1)?.closingContent()?.pastPosts).toEqual([]);
    expect(photoRevision().imageRefs()).toEqual([]);
  });

  it("AC-002-02 公開用画像の枚数と準備のしかたは中身が決める（写真は投稿画像の枚数を複製、テンプレートはスライドの枚数を画像化）", () => {
    expect([photoRevision().expectedPublishMediaCount(), photoRevision().preparation()]).toEqual([1, "COPY"]);
    expect([templateRevision().expectedPublishMediaCount(), templateRevision().preparation()]).toEqual([3, "RENDER"]);
    expect(templateRevision([sampleBody(), sampleBody()]).expectedPublishMediaCount()).toBe(4);
  });

  it("AC-002-18 承認を依頼できない理由は、スライド・ハッシュタグ・文字数のどれもすべて返す（段階的にしない）", () => {
    const revision = PostRevision.ofSlides({ caption: Caption.restore("あ".repeat(2115)), prCategory: PrCategory.NONE,
      templateVersion: SAMPLE_TEMPLATE_VERSION, settings: sampleSettings(), additionalHashtags: ["#a", "#b", "#c", "#d", "#e", "#f"],
      slides: SlideList.restore([Slide.createCover(CoverContent.of(sampleCoverText())), Slide.createClosing(ClosingContent.empty())]) });
    expect(revision.violationsForApproval(PR_LABEL)).toEqual([
      "中のスライドは1〜8枚にしてください（0枚）",
      "追加のハッシュタグは5個までです（6個）",
      "キャプションの定型とハッシュタグを含めて2,200文字以内にしてください（2,219文字）",
    ]);
  });

  it("AC-002-18 承認を依頼できない理由: スライド構成の並び・追加のハッシュタグ・キャプションの文字数", () => {
    expect(templateRevision().violationsForApproval(PR_LABEL)).toEqual([]);
    expect(templateRevision([sampleBody()], ["#a", "#b", "#c", "#d", "#e", "#f"]).violationsForApproval(PR_LABEL))
      .toEqual(["追加のハッシュタグは5個までです（6個）"]);
    const broken = PostRevision.ofSlides({ caption: Caption.of("本文"), prCategory: PrCategory.NONE, settings: sampleSettings(),
      templateVersion: SAMPLE_TEMPLATE_VERSION, additionalHashtags: [], slides: SlideList.restore([Slide.createCover(CoverContent.of(sampleCoverText())), Slide.createClosing(ClosingContent.empty())]) });
    expect(broken.violationsForApproval(PR_LABEL)).toEqual(["中のスライドは1〜8枚にしてください（0枚）"]);
  });

  it("AC-002-22 キャプション本文を上限を1文字超える長さに書き換えると、承認を依頼できず理由が出る", () => {
    const revisionOf = (length: number) => PostRevision.ofSlides({ caption: Caption.restore("あ".repeat(length)), prCategory: PrCategory.NONE,
      slides: sampleSlides(), templateVersion: SAMPLE_TEMPLATE_VERSION, settings: sampleSettings(), additionalHashtags: [] });
    expect(revisionOf(2114).violationsForApproval(PR_LABEL)).toEqual([]);
    expect(revisionOf(2115).violationsForApproval(PR_LABEL))
      .toEqual(["キャプションの定型とハッシュタグを含めて2,200文字以内にしてください（2,201文字）"]);
    expect(revisionOf(2201).violationsForApproval(PR_LABEL)).toEqual(["キャプションは2,200文字以内です（2,201文字）"]);
  });

  it("下書き案の文言の取り込みはテンプレートの投稿だけ", () => {
    const draft = undefined as never;
    expect(() => photoRevision().withDraftText(draft)).toThrow("テンプレートの投稿だけ");
  });
});
