import { expect, test, type Page } from "@playwright/test";
import { solidPng } from "./solidPng";
import { useMockSupabase as mockSupabase, type MockWorld } from "./supabaseMock";

// REQ-002 単位5: S-03（作り方の2択）・S-07（AIで下書きを作る）・S-07b（手動コピペ）。Supabase と API関数は代役、375px で確かめる

const PHOTOS = [
  { id: "bg-1", path: "t1/backgrounds/1.jpg", description: "京都の街並み" },
  { id: "bg-2", path: "t1/backgrounds/2.jpg", description: "校舎の写真" },
];
const WORLD: MockWorld = { role: "EDITOR", heartbeatMinutesAgo: 5, posts: [], styleSettings: true, backgroundPhotos: PHOTOS };

type Body = { heading: string; description: string; emphases: string[]; picturePrompt: string; needsReplacement: boolean };
const body = (over: Partial<Body> = {}): Body => ({
  heading: "学割が使える", description: "学生証を見せるだけで割引になります", emphases: ["割引"], picturePrompt: "明るいカフェの背景", needsReplacement: false, ...over,
});
const proposal = (bodies: Body[] = [body(), body({ heading: "映画が安い", emphases: [], needsReplacement: true })], over: object = {}) => ({
  cover: { target: "同志社大生", keyword: "オトクな割引", annotation: "学生のうちに使い倒そう", closingWords: "まとめたよ", accent: "RED" },
  backgroundPhotoId: "bg-1", slides: bodies, caption: "学割のお知らせ", additionalHashtags: ["#学割"], prCategory: "NONE", sourceUrls: [], ...over,
});
const created = (p: object, over: object = {}) => ({
  generationId: "g-1", ideaId: "i-1", proposal: p, unsupportedFacts: [], usage: { used: 1, dailyLimit: 100, warnRatio: 0.8, warn: false }, ...over,
});
const json = (status: number, payload: unknown) => ({ status, contentType: "application/json", body: JSON.stringify(payload) });

/** API関数 /api/drafts… の代役。呼ばれた (パス, 本文) を記録する */
async function mockDraftApi(page: Page, handlers: Record<string, (body: Record<string, unknown>) => ReturnType<typeof json>>) {
  const calls: { path: string; body: Record<string, any> }[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any -- 本文の確認用
  await page.route("**/api/drafts**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const requestBody = route.request().postDataJSON() ?? {};
    calls.push({ path, body: requestBody });
    const key = Object.keys(handlers).find((k) => path.endsWith(k));
    return route.fulfill(key ? handlers[key](requestBody) : json(404, { error: { code: "NOT_FOUND", message: "no handler" } }));
  });
  return calls;
}

/** テンプレートのフォントは opaque origin の iframe から読むため CORS が要る（本番は _headers。静的配信の serve には無いので足す） */
async function allowTemplateFonts(page: Page) {
  await page.route("**/templates/**", async (route) => {
    try {
      const response = await route.fetch();
      const body = await response.body();
      await route.fulfill({ status: response.status(), headers: { ...response.headers(), "access-control-allow-origin": "*" }, body });
    } catch {
      // テストの終了でページが閉じたあと
    }
  });
}

async function useAiDraftPage(page: Page, handlers: Parameters<typeof mockDraftApi>[1], world: MockWorld = WORLD) {
  const { rpcCalls, rpcLog } = await mockSupabase(page, world);
  await allowTemplateFonts(page);
  const calls = await mockDraftApi(page, handlers);
  const saved: { p_post: string | null; p_revision: Record<string, any> }[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  page.on("request", (r) => { if (r.url().includes("/rpc/save_post_revision")) saved.push(r.postDataJSON()); });
  await page.goto("/posts/new/");
  await page.getByRole("radio", { name: "AIで作る" }).click();
  return { calls, saved, rpcCalls, rpcLog };
}

/** プレビューの iframe を1枚ずつ見える位置まで送り（画面の外はブラウザが描画を止める）、全スライドが描き終わるのを待つ */
async function expectAllRendered(page: Page, count: number) {
  const frames = page.locator('iframe[sandbox="allow-scripts"]');
  await expect(frames).toHaveCount(count);
  // 画面の外の iframe はブラウザが描画を止めるので、1枚ずつ見える位置に送り、その1枚が描き終わってから次へ進む
  for (let i = 0; i < count; i++) {
    await frames.nth(i).scrollIntoViewIfNeeded();
    await expect(page.locator("[data-render-status]").nth(i)).toHaveAttribute("data-render-status", "rendered");
  }
  await expect(page.locator('[data-render-status="rendered"]')).toHaveCount(count);
}

const generate = async (page: Page, idea = "学割の特集。11月3日に開催") => {
  await page.getByRole("textbox", { name: "ネタ" }).fill(idea);
  await page.getByRole("button", { name: "生成", exact: true }).click();
  await expect(page.getByRole("list", { name: "スライドのプレビュー" })).toBeVisible();
};

test("S-03 冒頭の2択で「AIで作る」を選ぶと S-07 に切り替わり、「写真で作る」は従来の流れのまま", async ({ page }) => {
  await mockSupabase(page, WORLD);
  await page.goto("/posts/new/");
  await expect(page.getByRole("radio", { name: "写真で作る" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByLabel("写真を選ぶ")).toBeAttached();
  await page.getByRole("radio", { name: "AIで作る" }).click();
  await expect(page.getByRole("textbox", { name: "ネタ" })).toBeVisible();
  await expect(page.getByLabel("写真を選ぶ")).toHaveCount(0);
});

test("AC-002-01 AC-002-06 生成 → 編集 → 保存。<script> を含む見出しはプレビューで文字として出て、保存の JSON は設計4章の形になる", async ({ page }) => {
  const dialogs: string[] = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); void d.dismiss(); });
  const p = proposal([body({ heading: "<script>alert(1)" }), body({ heading: "映画が安い", emphases: [], needsReplacement: true })]);
  const { calls, saved, rpcCalls } = await useAiDraftPage(page, {
    "/api/drafts": () => json(201, created(p, { usage: { used: 81, dailyLimit: 100, warnRatio: 0.8, warn: true } })),
  });
  await generate(page);

  expect(calls[0].body).toEqual({ ideaText: "学割の特集。11月3日に開催" });
  await expect(page.getByRole("note")).toContainText("上限に近づいています");
  // プレビュー: 4枚（表紙・中2・最後）を sandbox の iframe に描く
  await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(4);
  await expect(page.locator('iframe[sandbox="allow-scripts"]').first()).toHaveAttribute("src", "/templates/niijima@1/index.html");
  // 横にスワイプして見える位置まで送ると、すべて描き終わる
  await expectAllRendered(page, 4);
  const heading = page.frameLocator('iframe[title="中のスライド1のプレビュー"]').locator("#body-heading");
  await expect(heading).toHaveText("<script>alert(1)");
  expect(dialogs).toEqual([]);

  // 編集: 表紙のキーワードを直し、中のスライド1を選んで説明文を直す
  await page.getByRole("textbox", { name: "キーワード" }).fill("学割まとめ");
  await page.getByRole("button", { name: "中のスライド1を編集" }).click();
  await page.getByRole("textbox", { name: "見出し" }).fill("学割が使える");
  await page.getByRole("textbox", { name: "キャプション" }).fill("学割のお知らせ 11月3日");
  await expect(page.getByTestId("publish-caption")).toContainText("学割のお知らせ 11月3日");
  await expect(page.getByTestId("publish-caption")).toContainText("#新島info");
  await page.getByRole("button", { name: "保存", exact: true }).click();

  await expect.poll(() => saved.length).toBe(1);
  const r = saved[0].p_revision;
  expect(r).toMatchObject({ format: "CAROUSEL", mediaSource: "TEMPLATE", genreId: null, templateVersion: "niijima@1", generationId: "g-1",
    caption: "学割のお知らせ 11月3日", prCategory: "NONE", hashtags: ["#学割"] });
  expect(r.slides.map((s: { role: string }) => s.role)).toEqual(["COVER", "BODY", "BODY", "CLOSING"]);
  expect(r.slides[0]).toEqual({ role: "COVER", target: "同志社大生", keyword: "学割まとめ", annotation: "学生のうちに使い倒そう",
    closingWords: "まとめたよ", accent: "RED", backgroundPhotoId: "bg-1" });
  // 強調する語「割引」は説明文の中の位置（コードポイント）で渡る
  expect(r.slides[1]).toEqual({ role: "BODY", heading: "学割が使える", description: "学生証を見せるだけで割引になります",
    emphases: [{ start: 10, length: 2 }], picturePrompt: "明るいカフェの背景", needsReplacement: false });
  expect(r.slides[3]).toEqual({ role: "CLOSING" });
  expect(rpcCalls).toContain("save_post_revision");
});

test("AC-002-21 差し替えが必要の印が付いたスライドに「差し替えが必要」と出る", async ({ page }) => {
  await useAiDraftPage(page, { "/api/drafts": () => json(201, created(proposal())) });
  await generate(page);
  await expect(page.locator('[data-mark="replacement"]')).toHaveCount(1);
  await expect(page.locator('[data-mark="replacement"]')).toHaveText("差し替えが必要");
});

test("AC-002-13 ネタに無い日付には黄色の印が付き、ネタにある日付には付かない", async ({ page }) => {
  const p = proposal([body(), body()], { caption: "開催は11月3日、料金は1000円です" });
  await useAiDraftPage(page, { "/api/drafts": () => json(201, created(p)) });
  await generate(page, "学割の特集。11月3日に開催");
  await expect(page.locator('mark[data-mark="unsupported"]')).toHaveText(["1000円"]);
});

test("AC-002-16 背景写真が 0枚のときは表紙が紺の単色になり、保存の JSON の backgroundPhotoId は null", async ({ page }) => {
  const { saved } = await useAiDraftPage(page, { "/api/drafts": () => json(201, created(proposal(undefined, { backgroundPhotoId: undefined }))) },
    { ...WORLD, backgroundPhotos: [] });
  await generate(page);
  await expect(page.getByText("なし（紺の単色）")).toBeVisible();
  await page.getByRole("button", { name: "背景写真を選び直す" }).click();
  await expect(page.getByText("背景写真がまだありません。管理者が登録すると選べます")).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("button", { name: /写真$/ })).toHaveCount(0);
  await page.getByRole("button", { name: "使わない（紺の単色）" }).click();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0].p_revision.slides[0].backgroundPhotoId).toBeNull();
});

test("AC-002-16 背景写真が 3枚のときは、そのうち1枚が選ばれ、人が別の1枚に選び直せる（保存の JSON の backgroundPhotoId が変わる）", async ({ page }) => {
  const three = [...PHOTOS, { id: "bg-3", path: "t1/backgrounds/3.jpg", description: "図書館の写真" }];
  const { saved } = await useAiDraftPage(page, { "/api/drafts": () => json(201, created(proposal())) }, { ...WORLD, backgroundPhotos: three });
  await generate(page);
  await expect(page.getByText("京都の街並み")).toBeVisible();   // AI が選んだ1枚
  await page.getByRole("button", { name: "背景写真を選び直す" }).click();
  await expect(page.getByRole("dialog").getByRole("button", { pressed: true })).toHaveAccessibleName("京都の街並み");
  await expect(page.getByRole("dialog").getByRole("button", { name: /^(京都の街並み|校舎の写真|図書館の写真)$/ })).toHaveCount(3);
  await page.getByRole("button", { name: "校舎の写真" }).click();
  await expect(page.getByText("校舎の写真")).toBeVisible();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0].p_revision.slides[0].backgroundPhotoId).toBe("bg-2");
});

test("AC-002-05 修正指示で作り直しても、差し替えた素材画像と選び直した背景写真は保たれる（PR区分も）", async ({ page }) => {
  const revised = proposal([body({ heading: "もっと安い", description: "学生証で割引になるよ" , emphases: ["割引"] }), body({ heading: "映画も安い", emphases: [] })],
    { caption: "くだけた学割のお知らせ", backgroundPhotoId: "bg-1" });
  const { calls, saved } = await useAiDraftPage(page, {
    "/api/drafts": () => json(201, created(proposal())),
    "/revise": () => json(201, created(revised, { generationId: "g-2", parentGenerationId: "g-1", usage: { used: 2, dailyLimit: 100, warnRatio: 0.8, warn: false } })),
  });
  await generate(page);
  await page.getByRole("button", { name: "背景写真を選び直す" }).click();
  await page.getByRole("button", { name: "校舎の写真" }).click();
  await page.getByRole("button", { name: "中のスライド1を編集" }).click();
  await page.getByLabel("画像を差し替え").setInputFiles({ name: "m.png", mimeType: "image/png", buffer: solidPng(1200, 1600) });
  await expect(page.getByText("差し替えた画像")).toBeVisible();
  await page.getByRole("radio", { name: "PR案件" }).click();

  await page.getByRole("textbox", { name: "修正指示" }).fill("もっとくだけた感じで");
  await page.getByRole("button", { name: "作り直す" }).click();
  await expect(page.getByRole("textbox", { name: "キャプション" })).toHaveValue("くだけた学割のお知らせ");
  expect(calls.at(-1)!.path).toBe("/api/drafts/g-1/revise");
  expect(calls.at(-1)!.body).toMatchObject({ instruction: "もっとくだけた感じで", current: { prCategory: "PR", caption: "学割のお知らせ" } });

  // 文言は新しくなり、素材画像・背景写真・PR区分は保たれて、新しい生成を元にして保存される
  await expect(page.getByText("差し替えた画像")).toBeVisible();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => saved.length).toBe(1);
  const r = saved[0].p_revision;
  expect(r).toMatchObject({ generationId: "g-2", prCategory: "PR", caption: "くだけた学割のお知らせ" });
  expect(r.slides[0].backgroundPhotoId).toBe("bg-2");
  expect(r.slides[1].heading).toBe("もっと安い");
  expect(r.slides[1].material).toMatchObject({ storagePath: expect.stringMatching(/^t1\/posts\/.+\.jpg$/), width: 1200, height: 900 });
  expect(r.slides[1].material.byteSize).toBeGreaterThan(0);
  expect(r.slides[1].material.generation).toBeUndefined();
});

test("AC-002-20 絵を作れなくても（生成が失敗しても）下書きは残る", async ({ page }) => {
  await page.route("**/api/image-generations**", (route) => route.fulfill(json(409, { error: { code: "IMAGE_LIMIT_REACHED", message: "今日の画像生成は上限に達しました" } })));
  await useAiDraftPage(page, { "/api/drafts": () => json(201, created(proposal())) });
  await generate(page);
  await page.getByRole("button", { name: "中のスライド1を編集" }).click();
  await page.getByRole("button", { name: "絵を作る" }).click();
  await expect(page.getByRole("textbox", { name: "作りたい画像" })).toHaveValue("明るいカフェの背景");
  await page.getByRole("dialog", { name: "画像を生成する" }).getByRole("button", { name: "生成", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveText("今日の画像生成は上限に達しました");
  await page.getByRole("dialog").getByRole("button", { name: "キャンセル" }).click();
  await expect(page.getByRole("textbox", { name: "見出し" })).toHaveValue("学割が使える");
  await expect(page.getByText("画像なし（文字だけのカードになります）")).toBeVisible();
  await expect(page.getByRole("button", { name: "保存", exact: true })).toBeEnabled();
});

test("AC-002-07 上限・障害のときは「手動コピペで続ける」が主ボタンになり、違反は行ごとに出て、直すと取り込める", async ({ page }) => {
  let imports = 0;
  const { calls } = await useAiDraftPage(page, {
    "/api/drafts": () => json(409, { error: { code: "LLM_LIMIT_REACHED", message: "今日のAI生成は上限に達しました。手動コピペで続けられます", details: [], ideaId: "i-9" } }),
    "/manual-prompt": () => json(201, { ideaId: "i-9", promptVersionId: "pv-1", prompt: "次のネタから投稿を作ってください" }),
    "/manual": () => {
      imports += 1;
      return imports === 1
        ? json(400, { error: { code: "INVALID_OUTPUT", message: "取り込めません。直す点を確かめてください", details: ["slides[0].heading は文字列で指定してください", "cover.accent は必須です"] } })
        : json(201, created(proposal(), { ideaId: "i-9", usage: null }));
    },
  });
  await page.getByRole("textbox", { name: "ネタ" }).fill("学割の特集");
  await page.getByRole("button", { name: "生成", exact: true }).click();
  await expect(page.getByText("今日のAI生成は上限に達しました。手動コピペで続けられます")).toBeVisible();
  await expect(page.getByRole("button", { name: "手動コピペで続ける" })).toBeVisible();
  await page.getByRole("button", { name: "手動コピペで続ける" }).click();

  const sheet = page.getByRole("dialog", { name: "手動コピペで続ける" });
  await expect(sheet.getByRole("textbox", { name: "プロンプト" })).toHaveValue("次のネタから投稿を作ってください");
  // プロンプトを用意できたら「プロンプトをコピー」は押せる見た目（薄い無効の表示ではない）
  const copy = sheet.getByRole("button", { name: "プロンプトをコピー" });
  await expect(copy).toBeEnabled();
  await expect(copy).toHaveCSS("opacity", "1");
  expect(calls.find((c) => c.path.endsWith("/manual-prompt"))!.body).toEqual({ ideaId: "i-9" });
  await sheet.getByRole("textbox", { name: "貼り付ける JSON" }).fill("{ 壊れた");
  await sheet.getByRole("button", { name: "取り込む" }).click();
  await expect(sheet.getByRole("listitem")).toHaveText(["slides[0].heading は文字列で指定してください", "cover.accent は必須です"]);

  await sheet.getByRole("textbox", { name: "貼り付ける JSON" }).fill("```json\n" + JSON.stringify(proposal()) + "\n```");
  await sheet.getByRole("button", { name: "取り込む" }).click();
  await expect(page.getByRole("list", { name: "スライドのプレビュー" })).toBeVisible();
  expect(calls.filter((c) => c.path.endsWith("/api/drafts/manual")).at(-1)!.body).toMatchObject({ ideaId: "i-9", promptVersionId: "pv-1" });
});

test("AC-002-07 修正指示が失敗したときの手動コピペは、親の生成・指示・今の内容も送る", async ({ page }) => {
  const { calls } = await useAiDraftPage(page, {
    "/api/drafts": () => json(201, created(proposal())),
    "/revise": () => json(503, { error: { code: "LLM_UNAVAILABLE", message: "いまはAIを使えません。手動コピペで続けられます", details: [], ideaId: "i-1" } }),
    "/manual-prompt": () => json(201, { ideaId: "i-1", promptVersionId: "pv-2", prompt: "修正のプロンプト" }),
    "/manual": () => json(201, created(proposal([body({ heading: "直した" }), body()]), { generationId: "g-3", parentGenerationId: "g-1", usage: null })),
  });
  await generate(page);
  await page.getByRole("textbox", { name: "修正指示" }).fill("短くして");
  await page.getByRole("button", { name: "作り直す" }).click();
  await page.getByRole("button", { name: "手動コピペで続ける" }).click();
  const sheet = page.getByRole("dialog", { name: "手動コピペで続ける" });
  await expect(sheet.getByRole("textbox", { name: "プロンプト" })).toHaveValue("修正のプロンプト");
  await sheet.getByRole("textbox", { name: "貼り付ける JSON" }).fill(JSON.stringify(proposal()));
  await sheet.getByRole("button", { name: "取り込む" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const imported = calls.find((c) => c.path.endsWith("/api/drafts/manual"))!.body;
  expect(imported).toMatchObject({ ideaId: "i-1", promptVersionId: "pv-2", parentGenerationId: "g-1", instruction: "短くして" });
  expect(imported.current.slides).toHaveLength(2);
  expect(calls.find((c) => c.path.endsWith("/manual-prompt"))!.body).toMatchObject({ ideaId: "i-1", instruction: "短くして" });
});

test("S-07 375px で横にはみ出さない（生成後）。プレビューの下の印は折り返さない", async ({ page }) => {
  await useAiDraftPage(page, { "/api/drafts": () => json(201, created(proposal())) });
  await generate(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // 中のスライド2（差し替えが必要の印つき）を選ぶと「中のスライド2（編集中）」と印が並ぶ。どちらも文字は1行のまま
  await page.getByRole("button", { name: "中のスライド2を編集" }).click();
  const lines = (selector: string) => page.locator(selector).first().evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    // 文字の行の数（同じ高さの矩形は1行）
    return new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top))).size;
  });
  await expect(page.getByRole("button", { name: "中のスライド2（編集中）" })).toBeVisible();
  expect(await lines('button[aria-pressed="true"]')).toBe(1);
  expect(await lines('[data-mark="replacement"]')).toBe(1);
  await page.screenshot({ path: process.env.E2E_SHOT_DIR ? `${process.env.E2E_SHOT_DIR}/s07-375.png` : "test-results/s07-375.png", fullPage: false });
});

test("AC-002-22 キーワードを13文字・キャプション本文を上限を1文字超える長さに書き換えると、保存できず理由が出る。直すと保存できる", async ({ page }) => {
  const { saved } = await useAiDraftPage(page, { "/api/drafts": () => json(201, created(proposal())) });
  await generate(page);
  await page.getByRole("textbox", { name: "キーワード" }).fill("あ".repeat(13));
  await page.getByRole("textbox", { name: "キャプション" }).fill("あ".repeat(2201));
  await page.getByRole("button", { name: "保存", exact: true }).click();

  await expect(page.getByRole("alert").filter({ hasText: "表紙: キーワードは1〜12文字にしてください（13文字）" })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "キャプションは2,200文字以内です（2,201文字）" })).toBeVisible();
  await expect(page.locator('[data-violation="キーワード"]')).toHaveText("キーワードは1〜12文字にしてください（13文字）");
  expect(saved).toHaveLength(0);

  await page.getByRole("textbox", { name: "キーワード" }).fill("あ".repeat(12));
  await page.getByRole("textbox", { name: "キャプション" }).fill("学割のお知らせ");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0].p_revision.slides[0].keyword).toBe("あ".repeat(12));
});

test("AC-002-22 AC-002-18 「承認を依頼」も同じ検査で止まり、通れば保存してから request_approval が呼ばれる", async ({ page }) => {
  const { saved, rpcCalls } = await useAiDraftPage(page, { "/api/drafts": () => json(201, created(proposal())) });
  await generate(page);
  await page.getByRole("textbox", { name: "キーワード" }).fill("あ".repeat(13));
  await page.getByRole("button", { name: "承認を依頼" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "キーワードは1〜12文字にしてください（13文字）" })).toBeVisible();
  expect(saved).toHaveLength(0);
  expect(rpcCalls).not.toContain("request_approval");

  await page.getByRole("textbox", { name: "キーワード" }).fill("学割まとめ");
  await page.getByRole("button", { name: "承認を依頼" }).click();
  await expect.poll(() => rpcCalls.filter((c) => c === "save_post_revision" || c === "request_approval")).toEqual(["save_post_revision", "request_approval"]);
  expect(saved).toHaveLength(1);
});

test("AC-002-18 承認の依頼に失敗しても投稿は二重にできない（次の保存は、保存できた投稿の新しい版になる）", async ({ page }) => {
  const world: MockWorld = { ...WORLD, failOnce: { request_approval: { code: "P0001", message: "承認を依頼できません" } } };
  const { saved, rpcCalls } = await useAiDraftPage(page, { "/api/drafts": () => json(201, created(proposal())) }, world);
  await generate(page);
  await page.getByRole("button", { name: "承認を依頼" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "承認を依頼できません" })).toBeVisible();
  expect(saved.map((s) => s.p_post)).toEqual([null]);

  await page.getByRole("button", { name: "承認を依頼" }).click();
  await expect.poll(() => saved.length).toBe(2);
  expect(saved.map((s) => s.p_post)).toEqual([null, "new-post"]);
  await expect.poll(() => rpcCalls.filter((c) => c === "request_approval").length).toBe(2);
});

test("AC-002-19 生成した候補を素材画像に採用すると、保存の JSON の material に生成の参照（generation）と容量が載る", async ({ page }) => {
  await page.route("**/e2e-candidates/*.png", (route) => route.fulfill({ status: 200, contentType: "image/png", body: solidPng(1024, 1024) }));
  await page.route("**/api/image-generations**", (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/clear")) return route.fulfill({ status: 204 });
    return route.fulfill(json(201, {
      generationId: "ig-1", candidates: [1, 2, 3, 4].map((position) => ({ position, url: `/e2e-candidates/${position}.png` })),
      usage: { used: 1, dailyLimit: 20, warnRatio: 0.8 },
    }));
  });
  const { saved } = await useAiDraftPage(page, { "/api/drafts": () => json(201, created(proposal())) });
  await generate(page);
  await page.getByRole("button", { name: "中のスライド1を編集" }).click();
  await page.getByRole("button", { name: "絵を作る" }).click();
  await page.getByRole("dialog", { name: "画像を生成する" }).getByRole("button", { name: "生成", exact: true }).click();
  await page.getByRole("button", { name: "候補2" }).click();
  await page.getByRole("button", { name: "選んだ画像を使う（1）" }).click();
  await expect(page.getByText("AIで作った画像")).toBeVisible();

  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => saved.length).toBe(1);
  const material = saved[0].p_revision.slides[1].material;
  expect(material).toMatchObject({ storagePath: expect.stringMatching(/^t1\/posts\/.+\.jpg$/), width: 1024, height: 768,   // 1024×1024 の候補を 4:3 に切り取る
    generation: { generationId: "ig-1", candidatePosition: 2 } });
  expect(material.byteSize).toBeGreaterThan(0);
});

/** 保存済みのテンプレートの投稿（下書き）。説明文は絵文字を含み、強調する語はコードポイントの位置で持つ */
const SAVED_TEMPLATE = {
  cover: { target: "同志社大学", keyword: "学割", annotation: "", closingWords: "まとめたよ", accent: "RED", backgroundPhotoId: "bg-1" },
  bodies: [
    { heading: "学割が使える", description: "😀学割を使おう👍", emphases: [{ start: 1, length: 2 }], picturePrompt: "明るいカフェ",
      material: { path: "t1/posts/m1.jpg" } },
    { heading: "映画が安い", description: "学生証で割引になります", emphases: [], picturePrompt: "映画館", needsReplacement: true },
  ],
  hashtags: ["#学割"], generationId: "g-1", caption: "学割のお知らせ",
};

test("AC-002-12 保存済みの投稿を編集すると、コードポイントの位置から強調する語に戻り、もう一度保存して同じ位置になる（絵文字を含む説明文）", async ({ page }) => {
  await allowTemplateFonts(page);
  await mockSupabase(page, { ...WORLD, posts: [{ id: "tp1", status: "DRAFT", template: SAVED_TEMPLATE }] });
  const saved: { p_post: string | null; p_revision: Record<string, any> }[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  page.on("request", (r) => { if (r.url().includes("/rpc/save_post_revision")) saved.push(r.postDataJSON()); });
  await page.goto("/posts/edit/?id=tp1");
  await page.getByRole("button", { name: "中のスライド1を編集" }).click();
  await expect(page.getByRole("textbox", { name: "強調する語" })).toHaveValue("学割");
  await expect(page.getByRole("textbox", { name: "説明文" })).toHaveValue("😀学割を使おう👍");
  await page.getByRole("button", { name: "保存", exact: true }).click();

  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0].p_post).toBe("tp1");
  expect(saved[0].p_revision.slides[1]).toMatchObject({ description: "😀学割を使おう👍", emphases: [{ start: 1, length: 2 }],
    material: { storagePath: "t1/posts/m1.jpg", width: 1200, height: 900, byteSize: 150000 } });
  expect(saved[0].p_revision).toMatchObject({ generationId: "g-1", hashtags: ["#学割"] });
});

test("AC-002-12 説明文の前に絵文字を足してから保存すると、強調する語の位置はコードポイントで1つ後ろになる", async ({ page }) => {
  await allowTemplateFonts(page);
  await mockSupabase(page, { ...WORLD, posts: [{ id: "tp1", status: "DRAFT", template: SAVED_TEMPLATE }] });
  const saved: { p_revision: Record<string, any> }[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  page.on("request", (r) => { if (r.url().includes("/rpc/save_post_revision")) saved.push(r.postDataJSON()); });
  await page.goto("/posts/edit/?id=tp1");
  await page.getByRole("button", { name: "中のスライド1を編集" }).click();
  await page.getByRole("textbox", { name: "説明文" }).fill("🎉😀学割を使おう👍");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0].p_revision.slides[1].emphases).toEqual([{ start: 2, length: 2 }]);
});

test("AC-002-19 AC-002-02 S-04 テンプレートの投稿の詳細: スライドのプレビュー・最後のスライドの注記・公開用キャプション、写真風の素材画像で承認時の確認が出る", async ({ page }) => {
  await allowTemplateFonts(page);
  const photoreal = { ...SAVED_TEMPLATE, bodies: [{ ...SAVED_TEMPLATE.bodies[0], material: { path: "t1/posts/m1.jpg", style: "PHOTOREALISTIC" as const } }, SAVED_TEMPLATE.bodies[1]] };
  await mockSupabase(page, { ...WORLD, role: "APPROVER", posts: [{ id: "tp2", status: "AWAITING_APPROVAL", template: photoreal }] });
  await page.goto("/posts/view/?id=tp2");

  await expect(page.getByRole("list", { name: "スライドのプレビュー" })).toBeVisible();
  await expectAllRendered(page, 4);   // 表紙・中2・最後のスライド
  await expect(page.getByText("過去の投稿は承認した時点の新しい2件が入ります")).toBeVisible();
  await expect(page.locator('[data-mark="replacement"]')).toHaveCount(1);
  const caption = page.getByText("学割のお知らせ").first();
  await expect(caption).toContainText("学割のお知らせ");
  await expect(caption).toContainText("※画像はAIで生成したイメージです");
  await expect(caption).toContainText("#新島info");
  await expect(caption).toContainText("#学割");
  await expect(page.getByText("写真風の生成画像を含みます。実際の出来事・場所・人の写真として使っていないか、実在の人物・商標が写っていないか確認してください")).toBeVisible();
  await expect(page.getByRole("button", { name: "承認して予約" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
