import { expect, test, type Page } from "@playwright/test";
import { useMockSupabase, type MockPost, type MockTemplate, type MockWorld } from "./supabaseMock";

// REQ-007: 最後のスライドの画像。編集のプレビュー・承認の画面・投稿の表示で、最後のスライドに並べる画像が決まりどおりに出る。Supabase は代役、375px で確かめる

const TEMPLATE: MockTemplate = {
  cover: { target: "同志社大学", keyword: "学割", annotation: "", closingWords: "まとめたよ", accent: "RED", backgroundPhotoId: "bg-1" },
  bodies: [{ heading: "学割が使える", description: "学生証で割引になります", emphases: [], picturePrompt: "明るいカフェ" }],
  hashtags: ["#学割"], generationId: "g-1", caption: "学割のお知らせ",
};
const SLIDE_COUNT = 3;   // 表紙・中1・最後
const A = "t1/style/A.jpg";
const B1 = "t1/style/B1.jpg";
const B2 = "t1/style/B2.jpg";

const world = (posts: MockPost[], over: Partial<MockWorld> = {}): MockWorld => ({
  role: "APPROVER", heartbeatMinutesAgo: 5, styleSettings: true, posts,
  backgroundPhotos: [{ id: "bg-1", path: "t1/backgrounds/1.jpg", description: "京都の街並み" }], ...over,
});

/** テンプレートのフォントは opaque origin の iframe から読むため CORS が要る（本番は _headers。静的配信の serve には無いので足す） */
async function allowTemplateFonts(page: Page) {
  await page.route("**/templates/**", async (route) => {
    try {
      const response = await route.fetch();
      await route.fulfill({ status: response.status(), headers: { ...response.headers(), "access-control-allow-origin": "*" }, body: await response.body() });
    } catch {
      // テストの終了でページが閉じたあと
    }
  });
}

/** 最後のスライドのプレビューに描かれた画像の位置と大きさ（テンプレートの 1080×1350 の座標）。描き終わるのを待つ */
async function closingCovers(page: Page): Promise<{ x: number; width: number; height: number }[]> {
  await expect(page.getByRole("list", { name: "スライドのプレビュー" })).toBeVisible();
  const frames = page.locator('iframe[sandbox="allow-scripts"]');
  await expect(frames).toHaveCount(SLIDE_COUNT);
  await frames.nth(SLIDE_COUNT - 1).scrollIntoViewIfNeeded();
  await expect(page.locator("[data-render-status]").nth(SLIDE_COUNT - 1)).toHaveAttribute("data-render-status", "rendered", { timeout: 20_000 });   // 並列で動かす負荷の中でも、フォントを読んで描き終わるまで待つ
  const covers = page.frameLocator('iframe[title="最後のスライドのプレビュー"]').locator("#closing-covers img");
  return covers.evaluateAll((imgs) => imgs.map((img) => {
    const r = img.getBoundingClientRect();
    return { x: Math.round(r.x), width: Math.round(r.width), height: Math.round(r.height) };
  }));
}

// 枠は 400×500。2枚なら 120〜520 と 560〜960、1枚なら真ん中の 340〜740、0枚なら画像の欄なし（BR-007-03）
const LAYOUT: Record<number, { x: number; width: number; height: number }[]> = {
  0: [],
  1: [{ x: 340, width: 400, height: 500 }],
  2: [{ x: 120, width: 400, height: 500 }, { x: 560, width: 400, height: 500 }],
};
const CLOSING_IMAGES: Record<number, string[]> = { 0: [], 1: [A], 2: [B1, B2] };

for (const count of [0, 1, 2]) {
  test(`AC-007-05 編集のプレビューの最後のスライドは、最新の設定の画像 ${count}枚を 400×500 の枠で左から並べる`, async ({ page }) => {
    await allowTemplateFonts(page);
    await useMockSupabase(page, world([{ id: "tp1", status: "DRAFT", template: TEMPLATE }], { role: "EDITOR", styleClosingImages: CLOSING_IMAGES[count] }));
    await page.goto("/posts/edit/?id=tp1");
    expect(await closingCovers(page)).toEqual(LAYOUT[count]);
  });
}

test("AC-007-06 承認の画面（承認待ち）は、投稿の版が記録した設定の版の画像（最新の版に変えても記録のまま）", async ({ page }) => {
  await allowTemplateFonts(page);
  const post: MockPost = { id: "tp2", status: "AWAITING_APPROVAL", template: { ...TEMPLATE, recordedClosingImages: [A] } };
  await useMockSupabase(page, world([post], { styleClosingImages: [B1, B2] }));
  await page.goto("/posts/view/?id=tp2");
  expect(await closingCovers(page)).toEqual(LAYOUT[1]);
  await expect(page.getByText("過去の投稿は承認した時点の新しい2件が入ります")).toHaveCount(0);
});

test("AC-007-07 版1（画像A）で保存した下書きを開くと、編集のプレビューは最新の版2（画像B）を出す", async ({ page }) => {
  await allowTemplateFonts(page);
  const post: MockPost = { id: "tp2", status: "DRAFT", template: { ...TEMPLATE, recordedClosingImages: [A] } };
  await useMockSupabase(page, world([post], { role: "EDITOR", styleClosingImages: [B1, B2] }));
  await page.goto("/posts/edit/?id=tp2");
  expect(await closingCovers(page)).toEqual(LAYOUT[2]);
});

const approved = (approvalPastPosts: string[], recordedClosingImages: string[]): MockPost =>
  ({ id: "tp3", status: "SCHEDULED", scheduledAt: new Date(Date.now() + 3_600_000), approvalPastPosts, template: { ...TEMPLATE, recordedClosingImages } });

test("AC-007-09 REQ-007 より前に承認した投稿の表示は、承認の記録の過去の投稿の表紙2件（設定の画像には変わらない）", async ({ page }) => {
  await allowTemplateFonts(page);
  await useMockSupabase(page, world([approved(["t1/posts/p2/1.jpg", "t1/posts/p3/1.jpg"], [])], { styleClosingImages: [A] }));
  await page.goto("/posts/view/?id=tp3");
  expect(await closingCovers(page)).toEqual(LAYOUT[2]);
});

test("AC-007-09 REQ-007 より前に承認した投稿で記録が0件で、記録した設定の版に画像が無ければ、画像の欄なし", async ({ page }) => {
  await allowTemplateFonts(page);
  await useMockSupabase(page, world([approved([], [])], { styleClosingImages: [B1, B2] }));
  await page.goto("/posts/view/?id=tp3");
  expect(await closingCovers(page)).toEqual(LAYOUT[0]);
});

test("AC-007-08 AC-007-06 承認の記録に過去の投稿が無い承認は、記録した設定の版の画像（最新の版の画像ではない）", async ({ page }) => {
  await allowTemplateFonts(page);
  await useMockSupabase(page, world([approved([], [A])], { styleClosingImages: [B1, B2] }));
  await page.goto("/posts/view/?id=tp3");
  expect(await closingCovers(page)).toEqual(LAYOUT[1]);
});

test("AC-007-10 過去の投稿の表紙と設定の画像は混ぜない（記録に表紙があれば表紙だけ）", async ({ page }) => {
  await allowTemplateFonts(page);
  await useMockSupabase(page, world([approved(["t1/posts/p2/1.jpg"], [B1, B2])]));
  await page.goto("/posts/view/?id=tp3");
  expect(await closingCovers(page)).toEqual(LAYOUT[1]);
});
