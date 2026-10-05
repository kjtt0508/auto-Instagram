import { describe, expect, it } from "vitest";
import fixture from "../../../../docs/model/fixtures/caption.json";
import { SAMPLE_TEMPLATE_VERSION, sampleBody, sampleMaterial, sampleSettings, sampleSlides } from "../__tests__/samples";
import { Caption } from "./Caption";
import { GeneratedImage } from "./GeneratedImage";
import { Hashtag } from "./Hashtag";
import { Post } from "./Post";
import { PostFormat } from "./PostFormat";
import { PostMedia } from "./PostMedia";
import { PostMediaList } from "./PostMediaList";
import { PostRevision } from "./PostRevision";
import { PostStatus } from "./PostStatus";
import { PrCategory } from "./PrCategory";

const textOf = (segments: { repeat: string; count: number }[]) =>
  segments.map((s) => s.repeat.repeat(s.count)).join("");

/** aiDisclosure=true なら写真風の生成画像を1枚、そうでなければ撮った写真を1枚 */
const mediaOf = (aiDisclosure: boolean | undefined) => PostMediaList.of([PostMedia.of({
  position: 1, storagePath: "t/posts/1.jpg", width: 1080, height: 1350, bytes: 500_000,
  generated: aiDisclosure ? GeneratedImage.of({ generationId: "g1", candidatePosition: 1, styleCode: "PHOTOREALISTIC" }) : null,
})]);

const postOf = (text: string, prCategory: PrCategory, aiDisclosure: boolean | undefined) => Post.restore({
  id: "p1", status: PostStatus.DRAFT,
  content: { revisionId: "r1", format: PostFormat.FEED_IMAGE, caption: Caption.restore(text), prCategory, media: mediaOf(aiDisclosure), genreId: null },
  outcome: { scheduledAt: null, result: null, failure: null },
});

describe("キャプション・PR表記・AI生成の表示（fixtures/caption.json）", () => {
  it.each(fixture.cases)("$id $name", (c) => {
    const text = textOf(c.segments);
    const violations = Caption.violationsOf(text);
    expect(violations.length === 0).toBe(c.valid);
    if (!c.valid) {
      expect(violations).toContain(c.violation);
      return;
    }
    const content = { format: PostFormat.FEED_IMAGE, media: mediaOf(c.aiDisclosure), captionText: text, prCategory: PrCategory.from(c.prCategory) };
    const publishViolations = Post.violationsForApprovalRequest(content, fixture.prLabel);
    expect(publishViolations.length === 0).toBe(c.publishValid);
    if (!c.publishValid) expect(publishViolations).toContain(c.violation);
  });

  it.each(fixture.cases.filter((c) => c.publishText))("$id 公開用キャプション: $name", (c) => {
    const published = postOf(textOf(c.segments), PrCategory.from(c.prCategory), c.aiDisclosure).publishCaption(fixture.prLabel);
    expect(published.text.startsWith(c.publishText!.prefix)).toBe(true);
    expect(published.text.endsWith(c.publishText!.suffix ?? "")).toBe(true);
    expect(published.length()).toBe(c.publishText!.length);
    if (c.publishText!.text !== undefined) expect(published.text).toBe(c.publishText!.text);
  });

  it("AC-001-09 PR表記を付けると上限を超えるなら、公開用キャプションは作れない", () => {
    expect(() => postOf("あ".repeat(2196), PrCategory.PR, false).publishCaption(fixture.prLabel)).toThrow();
  });

  it("AC-005-05 背景・イラストの生成画像だけならAI生成の表示は付かない", () => {
    const media = PostMediaList.of([PostMedia.of({ position: 1, storagePath: "t/posts/1.jpg", width: 1080, height: 1350, bytes: 1,
      generated: GeneratedImage.of({ generationId: "g1", candidatePosition: 2, styleCode: "ILLUSTRATION" }) })]);
    const revision = PostRevision.ofPhotos({ caption: Caption.of("本文"), prCategory: PrCategory.NONE, media });
    expect(revision.aiDisclosure().isRequired()).toBe(false);
    expect(revision.publishCaption(fixture.prLabel).text).toBe("本文");
  });

  it("記録から戻すときは上限を検査しない（承認依頼の前に違反として出す）", () => {
    expect(Caption.restore("あ".repeat(2201)).remainingLength()).toBe(-1);
  });

  it("残り文字数を返す", () => {
    expect(Caption.of("あいう").remainingLength()).toBe(2197);
  });
});

describe("ハッシュタグの形（fixtures/caption.json の hashtagForms。全角空白・NBSP も空白）", () => {
  it.each(fixture.hashtagForms)("$id $name", (c) => {
    expect(Hashtag.parse(c.text) !== undefined).toBe(c.valid);
  });
});

describe("テンプレートの投稿の公開用キャプション（fixtures/caption.json の templateCases）", () => {
  const revisionOf = (c: (typeof fixture.templateCases)[number]) => {
    const body = c.body ?? textOf(c.segments ?? []);
    const bodies = c.aiDisclosure ? [sampleBody(sampleMaterial("PHOTOREALISTIC"))] : undefined;
    return PostRevision.ofSlides({
      caption: Caption.restore(body), prCategory: PrCategory.from(c.prCategory), slides: sampleSlides(bodies),
      templateVersion: SAMPLE_TEMPLATE_VERSION, settings: sampleSettings(), additionalHashtags: c.additionalHashtags,
    });
  };

  it.each(fixture.templateCases)("$id $name", (c) => {
    const revision = revisionOf(c);
    const violations = revision.violationsForApproval(fixture.prLabel);
    expect(violations.length === 0).toBe(c.publishValid);
    if (!c.publishValid) {
      expect(violations).toContain(c.violation);
      expect(() => revision.publishCaption(fixture.prLabel)).toThrow();
      return;
    }
    const published = revision.publishCaption(fixture.prLabel);
    if (c.publishText?.text !== undefined) expect(published.text).toBe(c.publishText.text);
    if (c.publishText?.length !== undefined) expect(published.length()).toBe(c.publishText.length);
  });

  it("AC-002-18 キャプション本文に使える文字数は、付記・定型・ハッシュタグを除いた分（本文の長さによらない）", () => {
    const remaining = (body: string, prCategory: PrCategory) => PostRevision.ofSlides({ caption: Caption.restore(body), prCategory,
      slides: sampleSlides(), templateVersion: SAMPLE_TEMPLATE_VERSION, settings: sampleSettings(), additionalHashtags: [] }).publishCaption(fixture.prLabel).remainingForCaption();
    expect(remaining("あ", PrCategory.NONE)).toBe(2114);
    expect(remaining("あいう", PrCategory.NONE)).toBe(2114);
    expect(remaining("あ", PrCategory.PR)).toBe(2109);
  });
});
