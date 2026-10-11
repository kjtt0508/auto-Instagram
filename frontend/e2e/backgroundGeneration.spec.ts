import { expect, test, type Page } from "@playwright/test";
import { solidPng } from "./solidPng";
import { useMockSupabase as mockSupabase, type MockWorld } from "./supabaseMock";

// REQ-006 単位4: 帯の色の7色（S-07 表紙の編集）・背景写真の選び直しの「AIで作る」・S-13 表紙の背景の設定・S-14 の AI の印。
// Supabase と API関数（下書き案・画像生成・背景写真にする）は代役、375px で確かめる

const PHOTOS = [
  { id: "bg-1", path: "t1/backgrounds/1.jpg", description: "京都の街並み" },
  { id: "bg-2", path: "t1/backgrounds/2.jpg", description: "校舎の写真" },
];
const photosOf = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `bg-${i + 1}`, path: `t1/backgrounds/${i + 1}.jpg`, description: `写真${i + 1}の説明` }));
const newWorld = (over: Partial<MockWorld> = {}): MockWorld => ({ role: "EDITOR", heartbeatMinutesAgo: 5, posts: [], styleSettings: true, backgroundPhotos: [...PHOTOS], ...over });

const PROMPT = "夕暮れの京都御苑、やわらかい光";
const ADOPTED_ID = "bg-ai-1";

type Body = { heading: string; description: string; emphases: string[]; picturePrompt: string; needsReplacement: boolean };
const body = (over: Partial<Body> = {}): Body => ({
  heading: "学割が使える", description: "学生証を見せるだけで割引になります", emphases: ["割引"], picturePrompt: "明るいカフェの背景", needsReplacement: false, ...over,
});
const proposal = (accent = "RED", over: object = {}) => ({
  cover: { target: "同志社大生", keyword: "オトクな割引", annotation: "学生のうちに使い倒そう", closingWords: "まとめたよ", accent },
  backgroundPhotoId: "bg-1", slides: [body(), body({ heading: "映画が安い", emphases: [] })], caption: "学割のお知らせ", additionalHashtags: ["#学割"],
  prCategory: "NONE", sourceUrls: [], ...over,
});
const created = (p: object, over: object = {}) => ({
  generationId: "g-1", ideaId: "i-1", proposal: p, unsupportedFacts: [], usage: { used: 1, dailyLimit: 100, warnRatio: 0.8, warn: false }, ...over,
});
const json = (status: number, payload: unknown) => ({ status, contentType: "application/json", body: JSON.stringify(payload) });
const apiError = (status: number, code: string, message: string) => json(status, { error: { code, message, details: [] } });

type Fulfill = ReturnType<typeof json>;
type AdoptionRequest = { generationId: string; candidatePosition: number; description: string };

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

type Options = {
  world?: MockWorld;
  /** 下書き案の生成（POST /api/drafts）と修正（/revise）の応答 */
  draft?: () => Fulfill;
  revise?: () => Fulfill;
  /** 画像生成（POST /api/image-generations）の応答。呼ばれるたびに順に使い、足りなければ最後のもの */
  generate?: Fulfill[];
  /** 背景写真にする（POST /api/background-photos）の応答。省略は 201 で、世界の背景写真にも足す */
  adopt?: ((request: AdoptionRequest, call: number) => Fulfill | null)[];
};

const candidates = () => json(201, {
  generationId: "ig-1", candidates: [1, 2, 3, 4].map((position) => ({ position, url: `/e2e-candidates/${position}.png` })),
  usage: { used: 1, dailyLimit: 20, warnRatio: 0.8 },
});

/** S-07（AIで下書きを作る）を開き、下書き案を生成するところまで進める。API関数は代役にして、呼ばれた内容を記録する */
async function openDraft(page: Page, options: Options = {}) {
  const world = options.world ?? newWorld();
  const { rpcLog, uploads } = await mockSupabase(page, world);
  await allowTemplateFonts(page);

  const drafts: { path: string; body: Record<string, unknown> }[] = [];
  await page.route("**/api/drafts**", (route) => {
    const path = new URL(route.request().url()).pathname;
    drafts.push({ path, body: route.request().postDataJSON() ?? {} });
    if (path.endsWith("/revise")) return route.fulfill(options.revise?.() ?? json(201, created(proposal("PINK"), { generationId: "g-2", parentGenerationId: "g-1" })));
    return route.fulfill(options.draft?.() ?? json(201, created(proposal())));
  });

  const generations: { style?: string; prompt?: string }[] = [];
  const cleared: string[] = [];
  await page.route("**/e2e-candidates/*.png", (route) => route.fulfill({ status: 200, contentType: "image/png", body: solidPng(1024, 1024) }));
  await page.route("**/api/image-generations**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/clear")) { cleared.push(path); return route.fulfill({ status: 204 }); }
    generations.push(route.request().postDataJSON());
    const replies = options.generate ?? [candidates()];
    return route.fulfill(replies[Math.min(generations.length, replies.length) - 1]);
  });

  const adoptions: AdoptionRequest[] = [];
  const requestedUrls: { url: string; type: string }[] = [];
  page.on("request", (r) => requestedUrls.push({ url: r.url(), type: r.resourceType() }));
  await page.route("**/api/background-photos", (route) => {
    const request = route.request().postDataJSON() as AdoptionRequest;
    adoptions.push(request);
    const custom = options.adopt?.[Math.min(adoptions.length, options.adopt.length) - 1]?.(request, adoptions.length);
    if (custom) return route.fulfill(custom);
    world.backgroundPhotos = [{ id: ADOPTED_ID, path: `t1/backgrounds/${ADOPTED_ID}.jpg`, description: request.description, generated: true }, ...(world.backgroundPhotos ?? [])];
    return route.fulfill(json(201, { photoId: ADOPTED_ID, storagePath: `t1/backgrounds/${ADOPTED_ID}.jpg`, description: request.description }));
  });

  const saved: { p_post: string | null; p_revision: Record<string, any> }[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any -- 本文の確認用
  page.on("request", (r) => { if (r.url().includes("/rpc/save_post_revision")) saved.push(r.postDataJSON()); });

  await page.goto("/posts/new/");
  await page.getByRole("radio", { name: "AIで作る" }).click();
  await page.getByRole("textbox", { name: "ネタ" }).fill("学割の特集。11月3日に開催");
  await page.getByRole("button", { name: "生成", exact: true }).click();
  await expect(page.getByRole("list", { name: "スライドのプレビュー" })).toBeVisible();
  return { world, drafts, generations, cleared, adoptions, requestedUrls, uploads, rpcLog, saved };
}

const picker = (page: Page) => page.getByRole("dialog", { name: "背景写真を選ぶ" });
const sheet = (page: Page) => page.getByRole("dialog", { name: "画像を生成する" });

/** 背景写真の選び直しから「AIで作る」を開く */
async function openBackgroundSheet(page: Page) {
  await page.getByRole("button", { name: "背景写真を選び直す" }).click();
  await picker(page).getByRole("button", { name: "AIで作る" }).click();
  await expect(sheet(page)).toBeVisible();
}

/** 指示を書いて生成し、候補の n 枚目を選ぶ（説明文の欄が出る） */
async function generateAndPick(page: Page, prompt: string, position = 2) {
  await sheet(page).getByRole("textbox", { name: "作りたい画像" }).fill(prompt);
  await sheet(page).getByRole("button", { name: "生成", exact: true }).click();
  await sheet(page).getByRole("button", { name: `候補${position}` }).click();
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** 表紙のプレビューの帯の左端の色（テンプレートが --accent-start に受け取った値） */
const bandStart = (page: Page) => page.frameLocator('iframe[title="表紙のプレビュー"]').locator("#cover-closing-text")
  .evaluate((el) => (el as HTMLElement).style.getPropertyValue("--accent-start").toUpperCase());

// ───────── 帯の色（7色） ─────────

const ACCENTS = [
  { name: "紫", code: "PURPLE", start: "#8C52FE" }, { name: "赤", code: "RED", start: "#FD3432" }, { name: "青緑", code: "TEAL", start: "#19BBAA" },
  { name: "青", code: "BLUE", start: "#3B82F6" }, { name: "緑", code: "GREEN", start: "#1FA35C" },
  { name: "オレンジ", code: "ORANGE", start: "#E8590C" }, { name: "ピンク", code: "PINK", start: "#E5528B" },
];

test("AC-006-02 帯の色は7色の色見本のボタンで、選ぶとプレビューの帯が変わる（選択中は aria-pressed、タップ領域は44pt以上）", async ({ page }) => {
  const { saved } = await openDraft(page);
  const group = page.getByRole("group", { name: "帯の色" });
  await expect(group.getByRole("button")).toHaveCount(7);
  for (const { name } of ACCENTS) await expect(group.getByRole("button", { name, exact: true })).toBeVisible();
  await expect(group.getByRole("button", { pressed: true })).toHaveAccessibleName("赤");
  await expect.poll(() => bandStart(page)).toBe("#FD3432");

  for (const { name, code, start } of ACCENTS.filter((a) => ["BLUE", "GREEN", "ORANGE", "PINK"].includes(a.code))) {
    await group.getByRole("button", { name, exact: true }).click();
    await expect(group.getByRole("button", { pressed: true })).toHaveAccessibleName(name);
    await expect(group.getByRole("button", { pressed: true })).toHaveCount(1);
    await expect.poll(() => bandStart(page), { message: `${code} の帯` }).toBe(start);
  }

  for (const button of await group.getByRole("button").all()) {
    const box = (await button.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  expect(await noHorizontalScroll(page)).toBe(true);

  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0].p_revision.slides[0].accent).toBe("PINK");
});

test("AC-006-02 色見本は選択中の見た目（枠とチェック）が分かり、7つとも帯のグラデーションの見本になる", async ({ page }) => {
  await openDraft(page);
  const group = page.getByRole("group", { name: "帯の色" });
  await group.scrollIntoViewIfNeeded();
  const swatches = await group.getByRole("button").evaluateAll((buttons) => buttons.map((b) => {
    const swatch = b.querySelector("span")!;
    return { pressed: b.getAttribute("aria-pressed"), background: getComputedStyle(swatch).backgroundImage + getComputedStyle(swatch).backgroundColor, check: swatch.querySelector("svg") !== null };
  }));
  expect(swatches.filter((s) => s.pressed === "true")).toHaveLength(1);
  expect(swatches.map((s) => s.check)).toEqual([false, true, false, false, false, false, false]);   // 赤だけチェック
  expect(new Set(swatches.map((s) => s.background)).size).toBe(7);                                   // 7色とも違う見本
});

test("AC-006-02 修正指示で作り直しても、選んだ帯の色は保たれる（AI が別の色を返しても上書きしない）。案内も出る", async ({ page }) => {
  const { drafts, saved } = await openDraft(page, { revise: () => json(201, created(proposal("PINK", { caption: "くだけた学割のお知らせ" }), { generationId: "g-2", parentGenerationId: "g-1" })) });
  const group = page.getByRole("group", { name: "帯の色" });
  await group.getByRole("button", { name: "緑", exact: true }).click();

  await expect(page.getByText("帯の色と背景は、上の表紙の編集で変えられます")).toBeVisible();
  await page.getByRole("textbox", { name: "修正指示" }).fill("もっとくだけた感じで");
  await page.getByRole("button", { name: "作り直す" }).click();
  await expect(page.getByRole("textbox", { name: "キャプション" })).toHaveValue("くだけた学割のお知らせ");
  expect(drafts.at(-1)!.path).toBe("/api/drafts/g-1/revise");

  await expect(group.getByRole("button", { pressed: true })).toHaveAccessibleName("緑");
  await expect.poll(() => bandStart(page)).toBe("#1FA35C");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0].p_revision).toMatchObject({ generationId: "g-2", caption: "くだけた学割のお知らせ" });
  expect(saved[0].p_revision.slides[0].accent).toBe("GREEN");
});

// ───────── 背景を作る（S-13 表紙の背景） ─────────

test("AC-006-04 AC-006-11 背景の選び直しから「AIで作る」→ 指示を書いて生成 → 1枚選ぶ → 説明文 →「この背景を使う」で表紙の背景になり、一覧にも出る", async ({ page }) => {
  const { adoptions, generations, cleared, requestedUrls, uploads, rpcLog, saved } = await openDraft(page);
  await openBackgroundSheet(page);

  // 候補を1枚だけ選べる（複数は選べない）。確定ボタンは「この背景を使う」
  await expect(sheet(page).getByRole("heading", { name: "AIで背景を作る" })).toBeVisible();
  await expect(sheet(page).getByRole("button", { name: "この背景を使う" })).toBeDisabled();
  await sheet(page).getByRole("textbox", { name: "作りたい画像" }).fill(PROMPT);
  await sheet(page).getByRole("button", { name: "生成", exact: true }).click();
  await sheet(page).getByRole("button", { name: "候補1" }).click();
  await sheet(page).getByRole("button", { name: "候補2" }).click();
  await expect(sheet(page).getByRole("button", { name: "候補1" })).toHaveAttribute("aria-pressed", "false");
  await expect(sheet(page).getByRole("button", { name: "候補2" })).toHaveAttribute("aria-pressed", "true");
  expect(generations).toEqual([{ style: "ILLUSTRATION", prompt: PROMPT }]);

  // 説明文の初めの値は指示の文
  const description = sheet(page).getByRole("textbox", { name: "背景写真の説明文" });
  await expect(description).toHaveValue(PROMPT);
  expect(await noHorizontalScroll(page)).toBe(true);
  await sheet(page).getByRole("button", { name: "この背景を使う" }).click();

  // 表紙の背景になる。説明文は「選んだ写真」ではなく、一覧にも出る
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("選んだ写真")).toHaveCount(0);
  await expect(page.getByText(PROMPT, { exact: true })).toBeVisible();
  expect(adoptions).toEqual([{ generationId: "ig-1", candidatePosition: 2, description: PROMPT }]);
  expect(cleared).toEqual(["/api/image-generations/ig-1/clear"]);   // 候補は片付ける

  // 画面は画像を取得・変換・アップロードしない。管理者の登録の経路も通さない（編集者のまま）
  expect(requestedUrls.filter((r) => r.url.includes("e2e-candidates") && r.type !== "image")).toEqual([]);
  expect(uploads).toEqual([]);
  expect(rpcLog.map((c) => c.name)).not.toContain("register_background_photo");

  await page.getByRole("button", { name: "背景写真を選び直す" }).click();
  const adopted = picker(page).getByRole("button", { name: PROMPT, exact: true });
  await expect(adopted).toHaveAttribute("aria-pressed", "true");
  await expect(adopted.locator('[data-mark="ai-background"]')).toHaveText("AI");
  await expect(picker(page).locator('[data-mark="ai-background"]')).toHaveCount(1);     // 管理者が登録した写真には印が付かない
  await expect(picker(page).getByRole("button", { name: /^(京都の街並み|校舎の写真)$/ })).toHaveCount(2);
  await picker(page).getByRole("button", { name: "キャンセル" }).click();

  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0].p_revision.slides[0].backgroundPhotoId).toBe(ADOPTED_ID);
});

test("AC-006-04 説明文: 複数行の指示は1行にまとまり、人が直せる。1〜100文字でなければ「この背景を使う」は押せず、欄の下に理由が出る", async ({ page }) => {
  const { adoptions } = await openDraft(page);
  await openBackgroundSheet(page);
  await generateAndPick(page, "夕暮れの京都御苑\nやわらかい光");
  const description = sheet(page).getByRole("textbox", { name: "背景写真の説明文" });
  const use = sheet(page).getByRole("button", { name: "この背景を使う" });
  await expect(description).toHaveValue("夕暮れの京都御苑 やわらかい光");
  await expect(use).toBeEnabled();

  await description.fill("");
  await expect(use).toBeDisabled();
  await expect(sheet(page).locator('[data-violation="背景写真の説明文"]')).toContainText("説明文を入力してください");
  await description.fill("あ".repeat(101));
  await expect(use).toBeDisabled();
  await expect(sheet(page).locator('[data-violation="背景写真の説明文"]')).toHaveText("説明文は100文字までです（101文字）");

  await description.fill("あ".repeat(100));
  await expect(use).toBeEnabled();
  await description.fill("夕暮れの御苑");
  await use.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(adoptions).toEqual([{ generationId: "ig-1", candidatePosition: 2, description: "夕暮れの御苑" }]);
  await expect(page.getByText("夕暮れの御苑", { exact: true })).toBeVisible();
});

test("AC-006-04 登録に失敗したら、背景は変えず理由を出し、候補は残ってもう一度押せる。読み直しに無くても登録した写真は一覧に出る", async ({ page }) => {
  const { adoptions, cleared, saved } = await openDraft(page, {
    adopt: [
      () => apiError(409, "CANDIDATE_GONE", "候補の画像が残っていません"),
      (request) => json(200, { photoId: ADOPTED_ID, storagePath: `t1/backgrounds/${ADOPTED_ID}.jpg`, description: request.description }),   // 世界には足さない
    ],
  });
  await openBackgroundSheet(page);
  await generateAndPick(page, PROMPT);
  await sheet(page).getByRole("button", { name: "この背景を使う" }).click();

  await expect(sheet(page).getByRole("alert")).toHaveText("候補の期限が切れました。作り直してください");
  await expect(sheet(page).getByRole("button", { name: "候補2" })).toHaveAttribute("aria-pressed", "true");
  await expect(sheet(page).getByRole("textbox", { name: "背景写真の説明文" })).toHaveValue(PROMPT);
  expect(cleared).toEqual([]);                                  // 候補は片付けない
  await sheet(page).getByRole("button", { name: "キャンセル" }).click();   // 閉じると片付ける
  await expect.poll(() => cleared.length).toBe(1);
  await picker(page).getByRole("button", { name: "キャンセル" }).click();
  await expect(page.getByText("京都の街並み")).toBeVisible();   // 背景は変わらない

  // やり直す（2回目は成功）
  await openBackgroundSheet(page);
  await generateAndPick(page, PROMPT);
  await sheet(page).getByRole("button", { name: "この背景を使う" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(adoptions).toHaveLength(2);
  await expect(page.getByText(PROMPT, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "背景写真を選び直す" }).click();
  await expect(picker(page).getByRole("button", { name: PROMPT, exact: true })).toHaveAttribute("aria-pressed", "true");
  await picker(page).getByRole("button", { name: "キャンセル" }).click();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0].p_revision.slides[0].backgroundPhotoId).toBe(ADOPTED_ID);
});

test("AC-006-06 画像の種類は「背景・イラスト」の固定の表示で、写真風は選べない（生成は ILLUSTRATION だけを要求する）", async ({ page }) => {
  const { generations } = await openDraft(page);
  await openBackgroundSheet(page);
  await expect(sheet(page).locator("[data-fixed-style]")).toHaveText("背景・イラスト");
  await expect(sheet(page).getByRole("radio")).toHaveCount(0);
  await expect(sheet(page).getByRole("radiogroup")).toHaveCount(0);
  await expect(sheet(page).getByText("写真風")).toHaveCount(0);

  await generateAndPick(page, PROMPT);
  expect(generations.map((g) => g.style)).toEqual(["ILLUSTRATION"]);
  await sheet(page).getByRole("button", { name: "キャンセル" }).click();
});

test("AC-006-06 素材画像の「絵を作る」は、これまでどおり画像の種類を選べる（写真風もある）", async ({ page }) => {
  await openDraft(page);
  await page.getByRole("button", { name: "中のスライド1を編集" }).click();
  await page.getByRole("button", { name: "絵を作る" }).click();
  await expect(sheet(page).getByRole("radio", { name: "写真風" })).toBeVisible();
  await expect(sheet(page).getByRole("radio", { name: "背景・イラスト" })).toBeVisible();
  await expect(sheet(page).locator("[data-fixed-style]")).toHaveCount(0);
  await expect(sheet(page).getByRole("textbox", { name: "背景写真の説明文" })).toHaveCount(0);
});

// ───────── 30枚 ─────────

test("AC-006-07 背景写真が30枚なら「AIで作る」を出さず、整理を促す案内が出る。29枚なら出る", async ({ page }) => {
  await openDraft(page, { world: newWorld({ backgroundPhotos: photosOf(30) }), draft: () => json(201, created(proposal("RED", { backgroundPhotoId: "bg-1" }))) });
  await page.getByRole("button", { name: "背景写真を選び直す" }).click();
  await expect(picker(page).getByText("背景写真が30枚です。管理者が使わない写真を整理してください")).toBeVisible();
  await expect(picker(page).getByRole("button", { name: "AIで作る" })).toHaveCount(0);
  await expect(picker(page).getByRole("button", { name: /の説明$/ })).toHaveCount(30);   // 登録した写真は選べる
});

test("AC-006-07 29枚から作ると30枚になり、選び直しをもう一度開くと「AIで作る」が消えて案内が出る", async ({ page }) => {
  const { adoptions } = await openDraft(page, { world: newWorld({ backgroundPhotos: photosOf(29) }), draft: () => json(201, created(proposal("RED", { backgroundPhotoId: "bg-1" }))) });
  await page.getByRole("button", { name: "背景写真を選び直す" }).click();
  await expect(picker(page).getByRole("button", { name: "AIで作る" })).toBeVisible();
  await expect(picker(page).getByText("背景写真が30枚です")).toHaveCount(0);
  await picker(page).getByRole("button", { name: "AIで作る" }).click();
  await generateAndPick(page, PROMPT);
  await sheet(page).getByRole("button", { name: "この背景を使う" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(adoptions).toHaveLength(1);

  await page.getByRole("button", { name: "背景写真を選び直す" }).click();
  await expect(picker(page).getByRole("button", { name: "AIで作る" })).toHaveCount(0);
  await expect(picker(page).getByText("背景写真が30枚です。管理者が使わない写真を整理してください")).toBeVisible();
});

test("AC-006-07 画面が29枚と思っていても、サーバーが30枚で拒否したら案内を出し、背景は変えない", async ({ page }) => {
  await openDraft(page, { world: newWorld({ backgroundPhotos: photosOf(29) }), adopt: [() => apiError(409, "BACKGROUND_LIMIT_REACHED", "背景写真は30枚までです")] });
  await openBackgroundSheet(page);
  await generateAndPick(page, PROMPT);
  await sheet(page).getByRole("button", { name: "この背景を使う" }).click();
  await expect(sheet(page).getByRole("alert")).toHaveText("背景写真が30枚です。管理者が使わない写真を整理してください");
  await sheet(page).getByRole("button", { name: "キャンセル" }).click();
  await picker(page).getByRole("button", { name: "キャンセル" }).click();
  await expect(page.getByText("写真1の説明", { exact: true })).toBeVisible();   // 下書き案が選んだ背景（bg-1）のまま
  await expect(page.getByText(PROMPT, { exact: true })).toHaveCount(0);
});

// ───────── 上限・障害 ─────────

test("AC-006-08 画像生成の回数が上限なら、背景用の案内が出て生成できない。表紙の背景と下書き案は変わらない", async ({ page }) => {
  const { generations, saved } = await openDraft(page, { world: newWorld({ imageGenerationsUsed: 20 }) });
  await openBackgroundSheet(page);
  await expect(sheet(page).getByText("今日の画像生成は上限に達しました。登録した背景写真から選んでください")).toBeVisible();
  await expect(sheet(page).getByText("写真を撮る・選ぶ")).toHaveCount(0);
  await expect(sheet(page).getByRole("button", { name: "生成", exact: true })).toBeDisabled();
  expect(generations).toEqual([]);

  await sheet(page).getByRole("button", { name: "キャンセル" }).click();
  await picker(page).getByRole("button", { name: "キャンセル" }).click();
  await expect(page.getByText("京都の街並み")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "キャプション" })).toHaveValue("学割のお知らせ");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0].p_revision.slides[0]).toMatchObject({ backgroundPhotoId: "bg-1", keyword: "オトクな割引" });
});

test("AC-006-08 生成で上限・英訳できない・提供元の失敗になったら、サーバーの文言ではなく背景用の案内を出す", async ({ page }) => {
  const { generations } = await openDraft(page, {
    generate: [
      apiError(409, "IMAGE_LIMIT_REACHED", "今日の画像生成は上限に達しました。写真を撮る・選ぶで続けてください"),
      apiError(503, "TRANSLATION_UNAVAILABLE", "いまは画像を作れません。写真を撮る・選ぶで続けてください"),
      apiError(502, "GENERATION_FAILED", "画像を生成できませんでした"),
      apiError(504, "GENERATION_TIMEOUT", "画像を生成できませんでした（時間切れ）"),
    ],
  });
  await openBackgroundSheet(page);
  await sheet(page).getByRole("textbox", { name: "作りたい画像" }).fill(PROMPT);
  const unavailable = "いまは背景を作れません。登録した背景写真から選んでください";
  const expected = ["今日の画像生成は上限に達しました。登録した背景写真から選んでください", unavailable, unavailable, unavailable];
  for (const message of expected) {
    await sheet(page).getByRole("button", { name: "生成", exact: true }).click();
    await expect(sheet(page).getByRole("alert")).toHaveText(message);
  }
  expect(generations).toHaveLength(4);
  await sheet(page).getByRole("button", { name: "キャンセル" }).click();
  await picker(page).getByRole("button", { name: "キャンセル" }).click();
  await expect(page.getByText("京都の街並み")).toBeVisible();   // 背景は変わらない
});

// ───────── 権限 ─────────

test("AC-006-09 編集者でも、生成した背景を背景写真にできる（管理者の登録の経路を通らず、画像のアップロードもしない）", async ({ page }) => {
  const world = newWorld({ role: "EDITOR" });
  const { adoptions, rpcLog, uploads } = await openDraft(page, { world });
  await openBackgroundSheet(page);
  await generateAndPick(page, PROMPT);
  await sheet(page).getByRole("button", { name: "この背景を使う" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText(PROMPT, { exact: true })).toBeVisible();
  expect(adoptions).toHaveLength(1);
  expect(world.backgroundPhotos?.[0]).toMatchObject({ id: ADOPTED_ID, generated: true });
  expect(rpcLog.map((c) => c.name)).not.toContain("register_background_photo");
  expect(uploads).toEqual([]);
});

// ───────── S-14 背景写真（管理者） ─────────

test("AC-006-04 S-14 背景写真の一覧で、AI が作った背景には AI の印が付き、管理者が登録した写真には付かない", async ({ page }) => {
  await mockSupabase(page, newWorld({
    role: "ADMIN", backgroundPhotos: [{ id: "bg-ai", path: "t1/backgrounds/ai.jpg", description: PROMPT, generated: true }, ...PHOTOS],
  }));
  await page.goto("/settings/backgrounds/");
  const list = page.getByRole("region", { name: "背景写真の一覧" });
  await expect(list.locator("[data-photo-id]")).toHaveCount(3);
  await expect(list.locator('[data-mark="ai-background"]')).toHaveCount(1);
  await expect(list.locator('[data-photo-id="bg-ai"] [data-mark="ai-background"]')).toHaveText("AI");
  await expect(list.locator('[data-photo-id="bg-1"] [data-mark="ai-background"]')).toHaveCount(0);
  await expect(list.getByRole("button", { name: `${PROMPT}を使わない` })).toBeVisible();   // 「使わない」の操作は同じ
  expect(await noHorizontalScroll(page)).toBe(true);
});
