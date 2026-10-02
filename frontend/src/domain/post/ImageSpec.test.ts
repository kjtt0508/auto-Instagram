import { describe, expect, it } from "vitest";
import fixture from "../../../../docs/model/fixtures/image-spec.json";
import { ImageSpec } from "./ImageSpec";
import { PostFormat } from "./PostFormat";
import { PostMedia } from "./PostMedia";
import { PostMediaList } from "./PostMediaList";

const spec = new ImageSpec();
const media = (position: number, width: number, height: number, bytes = 500_000) =>
  PostMedia.of({ position, storagePath: `t/posts/${position}.jpg`, width, height, bytes });

describe("画像仕様（fixtures/image-spec.json）", () => {
  it.each(fixture.images)("$name", (c) => {
    expect(spec.violationsOf(media(1, c.width, c.height, c.bytes))).toHaveLength(c.violations);
  });

  it.each(fixture.mediaCounts)("$id $format に $count 枚", (c) => {
    const list = PostMediaList.of(Array.from({ length: c.count }, (_, i) => media(i + 1, 1080, 1350)));
    const violations = list.violationsFor(PostFormat.from(c.format), spec);
    expect(violations.length === 0).toBe(c.accepted);
    if (!c.accepted) expect(violations).toContain(c.violation);
  });

  it.each(fixture.conversions)("$id 変換: $name", (c) => {
    const source = { width: c.width, height: c.height };
    const aspect = c.targetAspect ?? spec.targetAspectFor(source);
    const plan = spec.planConversion(source, { aspect, focus: 0.5 });
    expect(plan.output).toEqual({ width: c.outputWidth, height: c.outputHeight });
    expect(plan.violation).toBeNull();
    if (c.cropY !== undefined) expect(plan.crop.y).toBe(c.cropY);
    const converted = media(1, plan.output.width, plan.output.height);
    expect(spec.violationsOf(converted)).toEqual([]);
  });
});

describe("画像の変換", () => {
  it("AC-001-04 4:3・5MBのJPEGは幅1440以下・比率1.91:1〜4:5に収まる", () => {
    const plan = spec.planConversion({ width: 4032, height: 3024 }, { aspect: spec.targetAspectFor({ width: 4032, height: 3024 }), focus: 0.5 });
    const ratio = plan.output.width / plan.output.height;
    expect(plan.output.width).toBeLessThanOrEqual(1440);
    expect(ratio).toBeGreaterThanOrEqual(0.8);
    expect(ratio).toBeLessThanOrEqual(1.91);
  });

  it("AC-001-05 トリミング位置を上端・下端に調整できる", () => {
    const source = { width: 1080, height: 1920 };
    expect(spec.planConversion(source, { aspect: 0.8, focus: 0 }).crop.y).toBe(0);
    expect(spec.planConversion(source, { aspect: 0.8, focus: 1 }).crop.y).toBe(570);
  });

  it("幅320px未満になる画像は変換できない", () => {
    expect(spec.planConversion({ width: 300, height: 375 }, { aspect: 0.8, focus: 0.5 }).violation).not.toBeNull();
  });

  it("AC-001-06 カルーセルの1枚目と比率が違う画像は公開できない", () => {
    const list = PostMediaList.of([media(1, 1080, 1350), media(2, 1080, 1080)]);
    expect(list.violationsFor(PostFormat.CAROUSEL, spec)).toContain("カルーセルの画像は1枚目と同じ縦横比にそろえてください");
  });
});

describe("投稿画像一覧の並べ替え", () => {
  const list = PostMediaList.of([media(1, 1080, 1350), media(2, 1080, 1350), media(3, 1080, 1350)]);

  it("除くと1から詰め直す", () => {
    expect(list.without(1).items().map((m) => m.storagePath)).toEqual(["t/posts/2.jpg", "t/posts/3.jpg"]);
    expect(list.without(1).items().map((m) => m.position)).toEqual([1, 2]);
  });

  it("前に出すと順番が入れ替わる", () => {
    expect(list.movedForward(3).items().map((m) => m.storagePath)).toEqual(["t/posts/1.jpg", "t/posts/3.jpg", "t/posts/2.jpg"]);
  });

  it("AC-001-05 トリミングし直した画像を元の順番に差し込む", () => {
    const recropped = PostMedia.of({ position: 2, storagePath: "t/posts/2b.jpg", width: 1080, height: 1350, bytes: 400_000 });
    const replaced = list.without(2).inserted(recropped);
    expect(replaced.items().map((m) => [m.position, m.storagePath])).toEqual([
      [1, "t/posts/1.jpg"], [2, "t/posts/2b.jpg"], [3, "t/posts/3.jpg"],
    ]);
  });

  it("連番でなければ作れない", () => {
    expect(() => PostMediaList.of([media(1, 1080, 1350), media(3, 1080, 1350)])).toThrow();
  });
});
