import { describe, expect, it } from "vitest";
import fixture from "../../../../docs/model/fixtures/token-expiry.json";
import { TokenExpiry } from "./TokenExpiry";

const now = new Date("2026-10-02T01:00:00Z");
const HOUR_MS = 60 * 60 * 1000;

describe("トークン有効期限（fixtures/token-expiry.json）", () => {
  it.each(fixture.cases)("$id 残り $remainingHours 時間", (c) => {
    const expiry = TokenExpiry.of(new Date(now.getTime() + c.remainingHours * HOUR_MS));
    expect(expiry.remainingDays(now) <= 0 ? 0 : expiry.remainingDays(now)).toBe(c.remainingDays);
    expect(expiry.needsRefresh(now)).toBe(c.needsRefresh);
    expect(expiry.needsWarning(now)).toBe(c.needsWarning);
    expect(expiry.shouldFailWorkflow(true, now)).toBe(c.failWorkflowIfRefreshFailed);
    expect(expiry.shouldFailWorkflow(false, now)).toBe(false);
  });
});
