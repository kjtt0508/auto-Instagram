import { describe, expect, it } from "vitest";
import fixture from "../../../../docs/model/fixtures/post-status.json";
import { PostStatus } from "./PostStatus";

describe("投稿状態の遷移（fixtures/post-status.json）", () => {
  const cases = PostStatus.all().flatMap((from) => PostStatus.all().map((to) => ({ from, to })));

  it.each(cases)("BR-001-07 $from.code → $to.code", ({ from, to }) => {
    const allowed = (fixture.transitions as Record<string, string[]>)[from.code].includes(to.code);
    expect(from.canTransitTo(to)).toBe(allowed);
  });

  it("編集できるのは下書きだけ", () => {
    expect(PostStatus.all().filter((s) => s.isEditable()).map((s) => s.code)).toEqual(fixture.editable);
  });

  it("AC-001-22 カレンダーでは状態ごとに色分けされる", () => {
    const colors = [PostStatus.SCHEDULED, PostStatus.PUBLISHED, PostStatus.FAILED].map((s) => s.calendarColor());
    expect(new Set(colors).size).toBe(3);
  });

  it("知らない状態は復元できない", () => {
    expect(() => PostStatus.from("UNKNOWN")).toThrow();
  });
});
