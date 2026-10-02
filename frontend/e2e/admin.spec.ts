import { expect, test, type Page } from "@playwright/test";
import { minutesFromNow, useMockSupabase, type MockWorld } from "./supabaseMock";

const world = (overrides: Partial<MockWorld> = {}): MockWorld => ({
  role: "APPROVER", heartbeatMinutesAgo: 5,
  posts: [
    { id: "scheduled", status: "SCHEDULED", scheduledAt: minutesFromNow(60) },
    { id: "published", status: "PUBLISHED", scheduledAt: minutesFromNow(-120), publishedAt: minutesFromNow(-110) },
    { id: "failed", status: "FAILED", scheduledAt: minutesFromNow(-30),
      failure: { kind: "TOKEN_INVALID", message: "Instagram連携が無効です（code 190）" } },
    { id: "awaiting", status: "AWAITING_APPROVAL" },
  ],
  ...overrides,
});

const hasNoHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("AC-001-21 NFR-001-06 最後のバッチ稼働記録が61分前なら、ログイン時に「定期処理が止まっています」", async ({ page }) => {
  await useMockSupabase(page, world({ heartbeatMinutesAgo: 61 }));
  await page.goto("/");
  await expect(page.getByRole("alert").filter({ hasText: "定期処理が止まっています" })).toBeVisible();
});

test("NFR-001-06 稼働記録が新しければ、定期処理の警告は出ない", async ({ page }) => {
  await useMockSupabase(page, world({ heartbeatMinutesAgo: 5 }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /対応待ち/ })).toBeVisible();
  await expect(page.getByText("定期処理が止まっています")).toHaveCount(0);
});

test("AC-001-22 投稿カレンダーは状態ごとに色分けされ、失敗には理由と再実行ボタンが出る", async ({ page }) => {
  await useMockSupabase(page, world());
  await page.goto("/");
  const calendar = page.getByRole("region", { name: "投稿カレンダー" });
  const badges = ["SCHEDULED", "PUBLISHED", "FAILED"].map((s) => calendar.locator(`[data-status="${s}"]`).first());
  const colors = await Promise.all(badges.map((b) => b.evaluate((el) => getComputedStyle(el).backgroundColor)));
  expect(new Set(colors).size).toBe(3);
  const failed = calendar.locator('[data-post-id="failed"]');
  await expect(failed).toContainText("Instagram連携が無効です");
  await expect(failed).toContainText("設定画面から連携をやり直してください");
  await expect(failed.getByRole("button", { name: "今すぐ再実行" })).toBeVisible();
});

test("AC-001-18 失敗した投稿を「今すぐ再実行」すると retry_post が呼ばれる", async ({ page }) => {
  const { rpcCalls } = await useMockSupabase(page, world());
  await page.goto("/");
  await page.locator('[data-post-id="failed"]').getByRole("button", { name: "今すぐ再実行" }).click();
  await expect.poll(() => rpcCalls).toContain("retry_post");
});

test("AC-001-10 編集者には再実行も承認も出ない", async ({ page }) => {
  await useMockSupabase(page, world({ role: "EDITOR" }));
  await page.goto("/");
  await expect(page.locator('[data-post-id="failed"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "今すぐ再実行" })).toHaveCount(0);
  await page.goto("/posts/view/?id=awaiting");
  await expect(page.getByText("awaiting のキャプション")).toBeVisible();
  await expect(page.getByRole("button", { name: "承認して予約" })).toHaveCount(0);
});

test("NFR-001-02 承認待ちの確認から予約までホームから3タップ以内、375px で横スクロールなし", async ({ page }) => {
  const { rpcCalls } = await useMockSupabase(page, world());
  await page.goto("/");
  expect(await hasNoHorizontalScroll(page)).toBe(true);
  await page.getByRole("region", { name: "対応待ち" }).getByRole("link").first().click();       // 1タップ目: 確認
  await expect(page.getByText("awaiting のキャプション")).toBeVisible();
  expect(await hasNoHorizontalScroll(page)).toBe(true);
  await page.getByRole("button", { name: "承認して予約" }).click();                                // 2タップ目: 予約（日時は既定で翌日18:00）
  await expect.poll(() => rpcCalls).toContain("approve_post");
});

test("AC-001-03 設定画面に連携中のIGユーザー名と有効期限が出て、トークンは画面にも通信にも出ない", async ({ page }) => {
  const bodies: string[] = [];
  page.on("response", async (r) => {
    if (r.url().startsWith("https://e2e.supabase.test")) bodies.push(await r.text().catch(() => ""));
  });
  await useMockSupabase(page, world({ role: "ADMIN" }));
  await page.goto("/settings/");
  const section = page.getByRole("region", { name: "Instagram連携" });
  await expect(section).toContainText("@niijima_info");
  await expect(section).toContainText(/残り\d+日/);
  await expect(section.getByRole("button", { name: "連携し直す" })).toBeVisible();
  const html = await page.content();
  for (const text of [html, ...bodies]) expect(text).not.toMatch(/access_token|token_ciphertext|IGAA/);
});

test("AC-001-03 管理者でなければ連携の操作ボタンは出ない", async ({ page }) => {
  await useMockSupabase(page, world({ role: "APPROVER" }));
  await page.goto("/settings/");
  await expect(page.getByRole("region", { name: "Instagram連携" })).toContainText("@niijima_info");
  await expect(page.getByRole("button", { name: /連携し直す|連携を解除/ })).toHaveCount(0);
});

test("NFR-001-02 投稿作成・設定画面も 375px で横スクロールなし", async ({ page }) => {
  await useMockSupabase(page, world({ role: "ADMIN" }));
  for (const path of ["/posts/new/", "/settings/"]) {
    await page.goto(path);
    await expect(page.getByRole("heading").first()).toBeVisible();
    expect(await hasNoHorizontalScroll(page)).toBe(true);
  }
});
