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

  it("AC-007-09 最後のスライドを承認の記録で描くのは、予約中・公開処理中・公開済み・失敗だけ（下書き・承認待ち・破棄は描かない）", () => {
    const drawn = Object.fromEntries(PostStatus.all().map((s) => [s.code, s.drawsFromApproval()]));
    expect(drawn).toEqual({ DRAFT: false, AWAITING_APPROVAL: false, SCHEDULED: true, PUBLISHING: true, PUBLISHED: true, FAILED: true, DISCARDED: false });
  });

  it("知らない状態は復元できない", () => {
    expect(() => PostStatus.from("UNKNOWN")).toThrow();
  });
});
