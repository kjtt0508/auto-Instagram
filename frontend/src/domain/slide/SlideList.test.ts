import { describe, expect, it } from "vitest";
import fixture from "../../../../docs/model/fixtures/slide-list.json";
import { sampleBody, sampleCoverText, sampleMaterial, sampleSlides } from "../__tests__/samples";
import { PastPostCover } from "../post/PastPostCover";
import { BodyContent } from "./BodyContent";
import { ClosingContent } from "./ClosingContent";
import { CoverContent } from "./CoverContent";
import { Slide } from "./Slide";
import { SlideList } from "./SlideList";
import { SlideRole } from "./SlideRole";

const ROLE_OF_LETTER: Record<string, SlideRole> = { C: SlideRole.COVER, B: SlideRole.BODY, X: SlideRole.CLOSING };

describe("スライド構成の並びと枚数（fixtures/slide-list.json）", () => {
  it.each(fixture.cases)("$id $name", (c) => {
    const roles = [...c.layout].map((letter) => ROLE_OF_LETTER[letter]);
    expect(SlideList.violationsOf(roles)).toEqual(c.violations);
  });
});

describe("スライド構成の操作", () => {
  it("BR-002-11 中のスライドは8枚まで足せて、9枚目は例外", () => {
    const eight = Array.from({ length: 8 }, () => sampleBody());
    expect(sampleSlides(eight).canAddBody()).toBe(false);
    expect(() => sampleSlides(eight).withBodyAdded(sampleBody())).toThrow("中のスライドは1〜8枚");
    expect(sampleSlides([sampleBody()]).withBodyAdded(sampleBody()).count()).toBe(4);
  });

  it("BR-002-11 足した中のスライドは最後のスライドの前に入る", () => {
    const roles = sampleSlides().withBodyAdded(sampleBody()).items().map((s) => s.role);
    expect(roles).toEqual([SlideRole.COVER, SlideRole.BODY, SlideRole.BODY, SlideRole.CLOSING]);
  });

  it("BR-002-11 中のスライドは1枚になるまで外せる。表紙と最後のスライドは外せない", () => {
    const two = sampleSlides([sampleBody(), sampleBody()]);
    expect(two.canRemoveBody()).toBe(true);
    expect(two.withoutSlideAt(1).count()).toBe(3);
    expect(sampleSlides().canRemoveBody()).toBe(false);
    expect(() => sampleSlides().withoutSlideAt(1)).toThrow("中のスライドは1〜8枚");
    expect(() => two.withoutSlideAt(0)).toThrow("外せるのは中のスライドだけ");
    expect(() => two.withoutSlideAt(3)).toThrow("外せるのは中のスライドだけ");
  });

  it("役割の違うスライドには差し替えられない", () => {
    expect(() => sampleSlides().withSlideReplaced(1, Slide.createClosing(ClosingContent.empty()))).toThrow("同じ役割");
  });

  it("画像化に必要な画像の参照は、背景写真・素材画像・（渡された）過去の投稿の表紙", () => {
    const slides = sampleSlides([sampleBody(sampleMaterial("ILLUSTRATION")), sampleBody()]);
    expect(slides.imageRefs()).toEqual(["t/backgrounds/1.jpg", "t/materials/1.jpg"]);
    const covers = [PastPostCover.of("p2", "t/posts/p2/1.jpg", "p1"), PastPostCover.of("p3", "t/posts/p3/1.jpg", "p1")];
    expect(slides.withPastPosts(covers).imageRefs()).toEqual(
      ["t/backgrounds/1.jpg", "t/materials/1.jpg", "t/posts/p2/1.jpg", "t/posts/p3/1.jpg"]);
  });

  it("背景写真が無ければ参照は無い（紺の単色）", () => {
    const slides = SlideList.of([Slide.createCover(CoverContent.of(sampleCoverText())), Slide.createBody(sampleBody()),
      Slide.createClosing(ClosingContent.empty())]);
    expect(slides.imageRefs()).toEqual([]);
  });

  it("AC-002-14 AC-002-19 写真風の生成画像を素材画像に含むときだけAI生成の表示と承認時の確認が要る。人が差し替えた画像は生成画像ではない", () => {
    const check = (material?: ReturnType<typeof sampleMaterial>) => {
      const slides = sampleSlides([sampleBody(), sampleBody(material)]);
      return [slides.requiresAiDisclosure(), slides.needsApprovalCheck()];
    };
    expect(check(sampleMaterial("PHOTOREALISTIC"))).toEqual([true, true]);
    expect(check(sampleMaterial("ILLUSTRATION"))).toEqual([false, false]);
    expect(check(sampleMaterial())).toEqual([false, false]);
    expect(check()).toEqual([false, false]);
  });

  it("BodyContent は素材画像を差し替えられ、外すと文字だけのカードになる", () => {
    const withImage = sampleBody().withMaterial(sampleMaterial());
    expect(withImage.imageRefs()).toEqual(["t/materials/1.jpg"]);
    expect(withImage.withoutMaterial().imageRefs()).toEqual([]);
    expect(BodyContent.of({ text: withImage.text, brief: withImage.brief }).material).toBeUndefined();
  });

  it("AC-002-12 保存の形は表紙・中・最後の順で、強調する語はコードポイントの位置、素材画像は生成画像なら由来つき", () => {
    const stored = sampleSlides([sampleBody(sampleMaterial("ILLUSTRATION"))]).toStoredForm();
    expect(stored.map((s) => s.role)).toEqual(["COVER", "BODY", "CLOSING"]);
    expect(stored[0]).toMatchObject({ target: "同志社大学", accent: "PURPLE", backgroundPhotoId: "bg1" });
    expect(stored[1]).toMatchObject({ emphases: [{ start: 0, length: 3 }], needsReplacement: false,
      material: { storagePath: "t/materials/1.jpg", generation: { generationId: "g1", candidatePosition: 1 } } });
  });

  it("BR-002-15 過去の投稿の表紙は3件以上渡せない", () => {
    const three = ["a", "b", "c"].map((id) => PastPostCover.of(id, `t/${id}.jpg`, "p1"));
    expect(() => ClosingContent.of(three)).toThrow("2件まで");
  });
});
