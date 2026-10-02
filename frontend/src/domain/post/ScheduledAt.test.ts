import { describe, expect, it } from "vitest";
import fixture from "../../../../docs/model/fixtures/scheduled-at.json";
import { ScheduledAt } from "./ScheduledAt";

const now = new Date("2026-10-02T01:00:00Z");
const MINUTE_MS = 60 * 1000;

describe("予約日時の確定（fixtures/scheduled-at.json）", () => {
  it.each(fixture.decide)("$id $name", (c) => {
    const value = new Date(now.getTime() + c.offsetMinutes * MINUTE_MS);
    const violations = ScheduledAt.violationsOfDecision(value, now);
    expect(violations.length === 0).toBe(c.accepted);
    if (!c.accepted) {
      expect(violations).toContain(c.violation);
      expect(() => ScheduledAt.decide(value, now)).toThrow();
    }
  });

  it("AC-001-18 再実行の「今すぐ」は現在時刻で確定する", () => {
    expect(ScheduledAt.immediate(now).toISOString()).toBe(now.toISOString());
  });

  it("記録から戻すときは過去でも検査しない", () => {
    const past = new Date("2020-01-01T00:00:00Z");
    expect(ScheduledAt.restore(past).toISOString()).toBe(past.toISOString());
  });

  it("入力が空なら確定できない", () => {
    expect(ScheduledAt.violationsOfDecision(new Date(Number.NaN), now)).toEqual(["予約日時を入力してください"]);
  });
});
