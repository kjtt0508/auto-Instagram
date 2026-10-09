import { describe, expect, it } from "vitest";
import fixture from "../../../../docs/model/fixtures/slide-list.json";
import renderValues from "../../../../docs/model/fixtures/render-values.json";
import { sampleBody, sampleCoverText, sampleMaterial, sampleSettings, sampleSlides } from "../__tests__/samples";
import { PastPostCover } from "../post/PastPostCover";
import { PostStyleSettings } from "../post/PostStyleSettings";
import { BodyContent } from "./BodyContent";
import { ClosingContent } from "./ClosingContent";
import { CoverContent } from "./CoverContent";
import { CoverText } from "./CoverText";
import { MaterialImage } from "./MaterialImage";
import { Slide } from "./Slide";
import { SlideList } from "./SlideList";
import { SlideRole } from "./SlideRole";
import { SlideText } from "./SlideText";

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
      material: { storagePath: "t/materials/1.jpg", byteSize: 120_000, generation: { generationId: "g1", candidatePosition: 1 } } });
  });

  it("素材画像は容量が正の数でなければ作れない（保存先→容量の表は持たず、素材画像が持つ）", () => {
    expect(() => MaterialImage.of({ storagePath: "t/a.jpg", width: 800, height: 600, byteSize: 0 })).toThrow("正の数");
    expect(sampleMaterial().byteSize).toBe(120_000);
  });

  it("位置から、中のスライドの何枚目かを返す（表紙・最後のスライドは 0）", () => {
    const slides = sampleSlides([sampleBody(), sampleBody(), sampleBody()]);
    expect([0, 1, 2, 3, 4].map((i) => slides.bodyNumberAt(i))).toEqual([0, 1, 2, 3, 0]);
  });

  it("AC-002-22 人が書き換えた文言の違反は、どのスライドかを添えて列挙する（保存と承認の依頼の前に確かめる）", () => {
    const long = CoverContent.of(CoverText.restore({ target: "同志社大学", keyword: "あ".repeat(13), annotation: "", closingWords: "まとめたよ", accentCode: "PURPLE" }));
    const slides = SlideList.of([Slide.createCover(long), Slide.createBody(sampleBody()),
      Slide.createBody(BodyContent.of({ text: SlideText.restore({ heading: "", description: "あ", emphases: [] }), brief: sampleBody().brief })),
      Slide.createClosing(ClosingContent.empty())]);
    const violations = slides.textViolations(sampleSettings());
    expect(violations.some((v) => v.startsWith("表紙: ") && v.includes("12文字"))).toBe(true);
    expect(violations.filter((v) => v.startsWith("中のスライド2枚目: "))).toHaveLength(1);
    expect(violations.some((v) => v.startsWith("中のスライド1枚目: "))).toBe(false);
  });
});

describe("テンプレートに渡す描画値（fixtures/render-values.json。Java の画像化と同じ JSON）", () => {
  type Input = (typeof renderValues.cases)[number]["slides"][number] & Record<string, unknown>;
  const slideOf = (s: Input): Slide => {
    if (s.role === "COVER") {
      return Slide.createCover(CoverContent.of(CoverText.restore({ target: s.target as string, keyword: s.keyword as string,
        annotation: s.annotation as string, closingWords: s.closingWords as string, accentCode: s.accent as string }),
      s.background ? { photoId: "bg", storagePath: s.background as string } : undefined));
    }
    if (s.role === "BODY") {
      return Slide.createBody(BodyContent.of({
        text: SlideText.restore({ heading: s.heading as string, description: s.description as string, emphases: s.emphases as string[] }),
        brief: sampleBody().brief,
        material: s.material ? MaterialImage.of({ storagePath: s.material as string, width: 800, height: 600, byteSize: 120_000 }) : undefined,
      }));
    }
    return Slide.createClosing(ClosingContent.of((s.pastPosts as string[]).map((p, i) => PastPostCover.of(`p${i}`, p, "own"))));
  };

  it.each(renderValues.cases)("$id $name", (c) => {
    const base = sampleSettings();
    const settings = PostStyleSettings.of({ tenantId: "t1", version: 1, bandText: c.settings.bandText, coverTargets: ["同志社大学"],
      closingMessage: c.settings.closingMessage, accountIntroduction: c.settings.accountIntroduction,
      captionFooter: base.captionFooter(), fixedHashtags: base.fixedHashtags(), logoStoragePath: (c.settings as { logo?: string }).logo });
    const slides = c.slides.map((s) => slideOf(s as Input));

    expect(JSON.parse(JSON.stringify(settings.renderValues()))).toEqual(c.expected.settings);
    expect(JSON.parse(JSON.stringify(slides.map((s) => s.renderValues())))).toEqual(c.expected.slides);
  });
});

describe("スライド構成の操作（続き）", () => {
  it("BR-002-11 画面が表示する枚数の上限・下限は定数から作る", () => {
    expect([SlideList.BODY_MIN, SlideList.BODY_MAX, PastPostCover.MAX_COUNT]).toEqual([1, 8, 2]);
  });

  it("BR-002-15 過去の投稿の表紙は3件以上渡せない", () => {
    const three = ["a", "b", "c"].map((id) => PastPostCover.of(id, `t/${id}.jpg`, "p1"));
    expect(() => ClosingContent.of(three)).toThrow("2件まで");
  });
});
