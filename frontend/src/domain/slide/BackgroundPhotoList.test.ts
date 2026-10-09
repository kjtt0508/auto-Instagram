import { describe, expect, it } from "vitest";
import { BackgroundPhoto, BackgroundPhotoList } from "./BackgroundPhotoList";

const photo = (n: number) => BackgroundPhoto.restore({ id: `bg-${n}`, storagePath: `t1/backgrounds/${n}.jpg`, description: `写真${n}` });
const photos = (n: number) => Array.from({ length: n }, (_, i) => photo(i + 1));

describe("背景写真一覧（BR-002-21）", () => {
  it("AC-002-24 使う写真が29枚までは足せて、30枚になったら足せない", () => {
    expect(BackgroundPhotoList.of(photos(0)).canAdd()).toBe(true);
    expect(BackgroundPhotoList.of(photos(29)).canAdd()).toBe(true);
    expect(BackgroundPhotoList.of(photos(30)).canAdd()).toBe(false);
  });

  it("31枚の一覧は作れない", () => {
    expect(() => BackgroundPhotoList.of(photos(31))).toThrow("30枚まで");
  });

  it("AC-002-16 AI に渡す候補は、写真IDと説明文だけ（0枚なら空）", () => {
    expect(BackgroundPhotoList.of(photos(0)).candidates()).toEqual([]);
    expect(BackgroundPhotoList.of(photos(2)).candidates()).toEqual([{ id: "bg-1", description: "写真1" }, { id: "bg-2", description: "写真2" }]);
  });
});

describe("背景写真の説明文（BR-002-21）", () => {
  it("AC-002-24 1〜100文字ならよい（100文字ちょうどはよい）", () => {
    expect(BackgroundPhoto.violationsOfDescription("正門")).toEqual([]);
    expect(BackgroundPhoto.violationsOfDescription("あ".repeat(100))).toEqual([]);
  });

  it("AC-002-24 空（空白だけ）と101文字は違反", () => {
    expect(BackgroundPhoto.violationsOfDescription("  ")).toHaveLength(1);
    expect(BackgroundPhoto.violationsOfDescription("あ".repeat(101))).toEqual(["説明文は100文字までです（101文字）"]);
  });
});
