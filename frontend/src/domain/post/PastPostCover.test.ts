import { describe, expect, it } from "vitest";
import { PastPostCover } from "./PastPostCover";

const published = (count: number) => Array.from({ length: count }, (_, i) => ({
  postId: `p${i + 1}`, coverStoragePath: `t/posts/p${i + 1}/1.jpg`, publishedAt: new Date(Date.UTC(2026, 9, i + 1)),
}));
const idsOf = (covers: PastPostCover[]) => covers.map((c) => c.postId);

describe("過去の投稿の表紙（最後のスライド）", () => {
  it("AC-002-15 公開済みの投稿が0件・1件・5件のとき、載るのは 0件・1件・公開日時が新しい2件", () => {
    expect(PastPostCover.createLatest("own", published(0))).toEqual([]);
    expect(idsOf(PastPostCover.createLatest("own", published(1)))).toEqual(["p1"]);
    expect(idsOf(PastPostCover.createLatest("own", published(5)))).toEqual(["p5", "p4"]);
  });

  it("AC-002-15 載せる投稿自身は選ばない", () => {
    expect(idsOf(PastPostCover.createLatest("p5", published(5)))).toEqual(["p4", "p3"]);
    expect(() => PastPostCover.of("p1", "t/a.jpg", "p1")).toThrow("投稿自身");
  });

  it("入力の並びを変えない", () => {
    const input = published(3);
    PastPostCover.createLatest("own", input);
    expect(input.map((p) => p.postId)).toEqual(["p1", "p2", "p3"]);
  });
});
