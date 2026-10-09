import { expect, test, type Page } from "@playwright/test";
import { solidPng } from "./solidPng";
import { useMockSupabase, type MockWorld } from "./supabaseMock";

// REQ-002 単位6: 管理者の画面（S-14 背景写真・S-15 投稿の型の設定・S-10 プロンプト版）。Supabase は代役、375px で確かめる

const photo = (n: number) => ({ id: `bg-${n}`, path: `t1/backgrounds/${n}.jpg`, description: `写真${n}の説明` });
const photos = (n: number) => Array.from({ length: n }, (_, i) => photo(i + 1));
const world = (over: Partial<MockWorld> = {}): MockWorld => ({ role: "ADMIN", heartbeatMinutesAgo: 5, posts: [], styleSettings: true, ...over });

const hasNoHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

// ───────── 入口と権限 ─────────

test("BR-002-21 設定の画面に、管理者だけ「下書きの生成」の入口（背景写真・投稿の型の設定・プロンプト版）が出る", async ({ page }) => {
  await useMockSupabase(page, world());
  await page.goto("/settings/");
  const section = page.getByRole("region", { name: "下書きの生成" });
  for (const name of ["背景写真", "投稿の型の設定", "プロンプト版"]) await expect(section.getByRole("link", { name })).toBeVisible();
  await section.getByRole("link", { name: "背景写真" }).click();
  await expect(page.getByRole("heading", { name: "背景写真" })).toBeVisible();
  await page.getByRole("link", { name: "‹ 設定" }).click();
  await expect(page.getByRole("heading", { name: "設定" })).toBeVisible();
});

for (const role of ["EDITOR", "APPROVER"] as const) {
  test(`BR-002-21 ${role === "EDITOR" ? "編集者" : "承認者"}には管理者の画面の入口が出ず、URL を直接開いても中身が出ない`, async ({ page }) => {
    const { rpcCalls } = await useMockSupabase(page, world({ role, backgroundPhotos: photos(2) }));
    await page.goto("/settings/");
    await expect(page.getByRole("region", { name: "Instagram連携" })).toBeVisible();
    await expect(page.getByRole("region", { name: "下書きの生成" })).toHaveCount(0);
    for (const path of ["/settings/backgrounds/", "/settings/style/", "/settings/prompts/"]) {
      await page.goto(path);
      await expect(page.getByText("この画面は管理者だけが使えます")).toBeVisible();
      await expect(page.getByRole("region", { name: "背景写真の一覧" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "新しい版として保存" })).toHaveCount(0);
    }
    expect(rpcCalls.filter((c) => /background|style_settings|prompt_version/.test(c))).toEqual([]);
  });
}

// ───────── S-14 背景写真 ─────────

test("AC-002-24 使っている写真を「使わない」にすると、消えずに一覧から外れる（確認してから）", async ({ page }) => {
  const { rpcLog } = await useMockSupabase(page, world({ backgroundPhotos: photos(3) }));
  await page.goto("/settings/backgrounds/");
  const list = page.getByRole("region", { name: "背景写真の一覧" });
  await expect(list.locator("[data-photo-id]")).toHaveCount(3);
  await expect(list).toContainText("写真2の説明");

  await list.getByRole("button", { name: "写真2の説明を使わない" }).click();
  await expect(list).toContainText("候補から外します（消えません）");
  await list.getByRole("button", { name: "使わなくする" }).click();

  await expect(list.locator("[data-photo-id]")).toHaveCount(2);
  await expect(list).not.toContainText("写真2の説明");
  expect(rpcLog.filter((c) => c.name === "retire_background_photo").map((c) => c.body)).toEqual([{ p_id: "bg-2" }]);
  expect(rpcLog.map((c) => c.name)).not.toContain("delete_background_photo");
});

test("AC-002-24 確認で「やめる」を押すと、何も起きない", async ({ page }) => {
  const { rpcCalls } = await useMockSupabase(page, world({ backgroundPhotos: photos(2) }));
  await page.goto("/settings/backgrounds/");
  const list = page.getByRole("region", { name: "背景写真の一覧" });
  await list.getByRole("button", { name: "写真1の説明を使わない" }).click();
  await list.getByRole("button", { name: "やめる" }).click();
  await expect(list.locator("[data-photo-id]")).toHaveCount(2);
  expect(rpcCalls).not.toContain("retire_background_photo");
});

test("AC-002-16 背景写真が 0枚なら、一覧に紺の単色になると出て、「写真を足す」から登録できる（保存先は backgrounds/、説明文は1〜100文字）", async ({ page }) => {
  const { rpcLog, uploads } = await useMockSupabase(page, world({ backgroundPhotos: [] }));
  await page.goto("/settings/backgrounds/");
  const list = page.getByRole("region", { name: "背景写真の一覧" });
  await expect(list).toContainText("まだ写真がありません");
  await expect(list).toContainText("紺の単色");

  await page.getByLabel("写真を足す").setInputFiles({ name: "gate.png", mimeType: "image/png", buffer: solidPng(1200, 1600) });
  const form = page.getByRole("region", { name: "新しい写真" });
  await expect(form.getByRole("img", { name: "変換した写真のプレビュー" })).toBeVisible();
  const register = form.getByRole("button", { name: "登録" });
  await expect(register).toBeDisabled();                                   // 説明文が空
  await form.getByRole("textbox", { name: "説明文" }).fill("あ".repeat(101));
  await expect(form).toContainText("説明文は100文字までです（101文字）");
  await expect(register).toBeDisabled();
  await form.getByRole("textbox", { name: "説明文" }).fill("今出川キャンパスの正門");
  await register.click();

  await expect(list.locator("[data-photo-id]")).toHaveCount(1);
  await expect(list).toContainText("今出川キャンパスの正門");
  expect(uploads).toHaveLength(1);
  expect(uploads[0]).toMatch(/^t1\/backgrounds\/[0-9a-f-]{36}\.jpg$/);
  expect(rpcLog.find((c) => c.name === "register_background_photo")?.body)
    .toEqual({ p_storage_path: uploads[0], p_description: "今出川キャンパスの正門" });
  expect(await hasNoHorizontalScroll(page)).toBe(true);
});

test("AC-002-24 使う写真が30枚なら「写真を足す」を出さず、29枚なら出す", async ({ page }) => {
  await useMockSupabase(page, world({ backgroundPhotos: photos(30) }));
  await page.goto("/settings/backgrounds/");
  await expect(page.getByRole("region", { name: "背景写真の一覧" })).toContainText("30 / 30枚");
  await expect(page.getByText("使う写真が30枚です")).toBeVisible();
  await expect(page.getByLabel("写真を足す")).toHaveCount(0);

  await page.getByRole("region", { name: "背景写真の一覧" }).getByRole("button", { name: "写真30の説明を使わない" }).click();
  await page.getByRole("button", { name: "使わなくする" }).click();
  await expect(page.getByLabel("写真を足す")).toBeAttached();
});

// ───────── AC-002-16: 表紙の背景（紺／選べる） ─────────

type Body = { heading: string; description: string; emphases: string[]; picturePrompt: string; needsReplacement: boolean };
const body = (): Body => ({ heading: "学割が使える", description: "学生証を見せるだけで割引になります", emphases: [], picturePrompt: "明るいカフェの背景", needsReplacement: false });
const proposal = () => ({
  cover: { target: "同志社大生", keyword: "オトクな割引", annotation: "学生のうちに使い倒そう", closingWords: "まとめたよ", accent: "RED" },
  backgroundPhotoId: "bg-1", slides: [body(), body()], caption: "学割のお知らせ", additionalHashtags: [], prCategory: "NONE", sourceUrls: [],
});

async function generateDraft(page: Page) {
  await page.route("**/api/drafts**", (route) => route.fulfill({
    status: 201, contentType: "application/json",
    body: JSON.stringify({ generationId: "g-1", ideaId: "i-1", proposal: proposal(), unsupportedFacts: [],
      usage: { used: 1, dailyLimit: 100, warnRatio: 0.8, warn: false } }),
  }));
  await page.route("**/templates/**", async (route) => {
    try {
      const response = await route.fetch();
      await route.fulfill({ status: response.status(), headers: { ...response.headers(), "access-control-allow-origin": "*" }, body: await response.body() });
    } catch {
      // テストの終了でページが閉じたあと
    }
  });
  await page.goto("/posts/new/");
  await page.getByRole("radio", { name: "AIで作る" }).click();
  await page.getByRole("textbox", { name: "ネタ" }).fill("学割の特集");
  await page.getByRole("button", { name: "生成", exact: true }).click();
  await expect(page.getByRole("list", { name: "スライドのプレビュー" })).toBeVisible();
}

test("AC-002-16 背景写真が 0枚なら、生成した下書きの表紙は紺の単色で、選べる写真が無い", async ({ page }) => {
  await useMockSupabase(page, world({ backgroundPhotos: [] }));
  await generateDraft(page);
  await expect(page.getByText("なし（紺の単色）")).toBeVisible();
  await page.getByRole("button", { name: "背景写真を選び直す" }).click();
  const dialog = page.getByRole("dialog", { name: "背景写真を選ぶ" });
  await expect(dialog).toContainText("背景写真がまだありません");
  await expect(dialog.getByRole("button", { name: /写真\d/ })).toHaveCount(0);
});

test("AC-002-16 背景写真が 3枚なら、そのうち1枚が選ばれ、別の1枚に選び直せる", async ({ page }) => {
  await useMockSupabase(page, world({ backgroundPhotos: photos(3) }));
  await generateDraft(page);
  await expect(page.getByText("写真1の説明")).toBeVisible();
  await page.getByRole("button", { name: "背景写真を選び直す" }).click();
  const dialog = page.getByRole("dialog", { name: "背景写真を選ぶ" });
  await expect(dialog.getByRole("button", { name: /^写真\dの説明$/ })).toHaveCount(3);
  await dialog.getByRole("button", { name: "写真3の説明" }).click();
  await expect(page.getByText("写真3の説明")).toBeVisible();
});

// ───────── S-15 投稿の型の設定 ─────────

test("BR-002-17 投稿の型の設定を直して保存すると、新しい版として送られる（検査はドメイン、重複のハッシュタグは1つ）", async ({ page }) => {
  const { rpcLog } = await useMockSupabase(page, world());
  await page.goto("/settings/style/");
  await expect(page.getByRole("textbox", { name: "上端の帯の文言" })).toHaveValue("新島info");
  await expect(page.getByRole("textbox", { name: "表紙の対象の候補" })).toHaveValue("同志社大学、同志社大生");
  await expect(page.getByRole("textbox", { name: "固定ハッシュタグ" })).toHaveValue("#新島info #同志社");
  await expect(page.getByText("いまの版: 版1。保存すると版2になります")).toBeVisible();

  await page.getByRole("textbox", { name: "上端の帯の文言" }).fill("同志社生向けSNSメディア");
  await page.getByRole("textbox", { name: "固定ハッシュタグ" }).fill("#同志社大学  #同志社 #同志社大学");
  await page.getByRole("button", { name: "新しい版として保存" }).click();

  await expect(page.getByRole("status")).toContainText("版2として保存しました");
  expect(rpcLog.find((c) => c.name === "save_post_style_settings")?.body).toEqual({
    p_band_text: "同志社生向けSNSメディア", p_cover_targets: ["同志社大学", "同志社大生"],
    p_closing_message: "ご覧いただきありがとうございます", p_account_introduction: "@niijima_info\n学生生活を発信中",
    p_caption_footer: "──────\n新島info", p_fixed_hashtags: ["#同志社大学", "#同志社"], p_logo_storage_path: null,
  });
  await expect(page.getByText("いまの版: 版2。保存すると版3になります")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "上端の帯の文言" })).toHaveValue("同志社生向けSNSメディア");
});

test("BR-002-17 まだ一度も設定していない団体は、空の状態から入力でき、条件を満たさなければ保存できない。ロゴは style/ に PNG で保存する", async ({ page }) => {
  const { rpcLog, uploads } = await useMockSupabase(page, world({ styleSettings: false }));
  await page.goto("/settings/style/");
  await expect(page.getByText("まだ設定されていません。保存すると版1になります")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "表紙の対象の候補" })).toHaveValue("");

  await page.getByRole("button", { name: "新しい版として保存" }).click();     // 空のまま
  await expect(page.getByText("表紙の対象の候補を1件以上入れてください")).toBeVisible();
  await expect(page.getByText("キャプションの定型は空にできません")).toBeVisible();
  expect(rpcLog.map((c) => c.name)).not.toContain("save_post_style_settings");

  await page.getByRole("textbox", { name: "表紙の対象の候補" }).fill("同志社大学、同志社大生");
  await page.getByRole("textbox", { name: "キャプションの定型" }).fill("──────\n新島info");
  await page.getByRole("textbox", { name: "固定ハッシュタグ" }).fill("学割");
  await expect(page.getByText("ハッシュタグの形が正しくありません: 学割")).toBeVisible();
  await page.getByRole("textbox", { name: "固定ハッシュタグ" }).fill("#同志社大学");
  await page.getByLabel("ロゴを選ぶ").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: solidPng(600, 300) });
  await expect(page.getByRole("img", { name: "ロゴ" })).toBeVisible();
  await page.getByRole("button", { name: "新しい版として保存" }).click();

  await expect(page.getByRole("status")).toContainText("版1として保存しました");
  expect(uploads).toHaveLength(1);
  expect(uploads[0]).toMatch(/^t1\/style\/[0-9a-f-]{36}\.png$/);
  expect(rpcLog.find((c) => c.name === "save_post_style_settings")?.body).toMatchObject({
    p_band_text: "", p_cover_targets: ["同志社大学", "同志社大生"], p_caption_footer: "──────\n新島info",
    p_fixed_hashtags: ["#同志社大学"], p_logo_storage_path: uploads[0],
  });
  expect(await hasNoHorizontalScroll(page)).toBe(true);
});

test("BR-002-17 ロゴは保存した版から引き継がれ、「ロゴを外す」で外した版を保存できる", async ({ page }) => {
  const { rpcLog } = await useMockSupabase(page, world({ styleLogoPath: "t1/style/logo.png" }));
  await page.goto("/settings/style/");
  await expect(page.getByRole("img", { name: "ロゴ" })).toBeVisible();
  await page.getByRole("button", { name: "新しい版として保存" }).click();
  await expect(page.getByRole("status")).toContainText("版2として保存しました");
  expect(rpcLog.find((c) => c.name === "save_post_style_settings")?.body.p_logo_storage_path).toBe("t1/style/logo.png");

  await page.getByRole("button", { name: "ロゴを外す" }).click();
  await expect(page.getByRole("img", { name: "ロゴ" })).toHaveCount(0);
  await page.getByRole("button", { name: "新しい版として保存" }).click();
  await expect(page.getByRole("status")).toContainText("版3として保存しました");
  expect(rpcLog.filter((c) => c.name === "save_post_style_settings").at(-1)?.body.p_logo_storage_path).toBeNull();
});

// ───────── S-10 プロンプト版 ─────────

const PLAN_BODY = "今日は{{today}}。ネタ:\n{{ideaText}}\n対象: {{coverTargets}}\n色: {{accentColors}}\n写真:\n{{backgroundPhotos}}\n上限: {{limits}}";
const REVISE_BODY = "{{today}} {{ideaText}} {{coverTargets}} {{accentColors}} {{limits}} {{currentDraft}} {{instruction}} {{bodySlideCount}}";
const promptWorld = (over: Partial<MockWorld> = {}) => world({
  promptVersions: [
    { id: "pv-PLAN-1", purpose: "PLAN", versionNo: 1, body: PLAN_BODY },
    { id: "pv-PLAN-2", purpose: "PLAN", versionNo: 2, body: `${PLAN_BODY}\n（2版）` },
    { id: "pv-PLAN-3", purpose: "PLAN", versionNo: 3, body: `${PLAN_BODY}\n（3版）` },
    { id: "pv-REVISE-1", purpose: "REVISE", versionNo: 1, body: REVISE_BODY },
  ],
  activePrompts: { PLAN: "pv-PLAN-3", REVISE: "pv-REVISE-1" },
  ...over,
});
const versionRow = (page: Page, no: number) => page.getByRole("region", { name: "版の一覧" }).locator(`[data-version-no="${no}"]`);

test("AC-002-08 用途ごとの版の一覧に有効な版の印が出て、用途を切り替えると別の一覧になる", async ({ page }) => {
  await useMockSupabase(page, promptWorld());
  await page.goto("/settings/prompts/");
  await expect(versionRow(page, 3)).toHaveAttribute("data-active", "true");
  await expect(versionRow(page, 2)).toHaveAttribute("data-active", "false");
  await expect(page.getByRole("textbox", { name: "本文" })).toHaveValue(`${PLAN_BODY}\n（3版）`);   // 有効な版の本文
  await versionRow(page, 2).getByRole("button", { name: "版2" }).click();
  await expect(page.getByRole("textbox", { name: "本文" })).toHaveValue(`${PLAN_BODY}\n（2版）`);

  await page.getByRole("radio", { name: "修正指示による再生成" }).click();
  await expect(versionRow(page, 1)).toHaveAttribute("data-active", "true");
  await expect(page.getByRole("region", { name: "版の一覧" }).locator("[data-version-no]")).toHaveCount(1);
  await expect(page.getByRole("textbox", { name: "本文" })).toHaveValue(REVISE_BODY);
});

test("AC-002-08 本文を変えて保存すると、版4が作られて有効になり、版3は無効として残る（作ってから有効にする）", async ({ page }) => {
  const { rpcLog } = await useMockSupabase(page, promptWorld());
  await page.goto("/settings/prompts/");
  await page.getByRole("textbox", { name: "本文" }).fill(`${PLAN_BODY}\n（4版）`);
  await page.getByRole("button", { name: "新しい版として保存" }).click();

  await expect(versionRow(page, 4)).toHaveAttribute("data-active", "true");
  await expect(versionRow(page, 3)).toBeVisible();
  await expect(versionRow(page, 3)).toHaveAttribute("data-active", "false");
  await expect(page.getByRole("status")).toContainText("版4を有効にしました");
  expect(rpcLog.map((c) => c.name).filter((n) => /prompt_version/.test(n))).toEqual(["create_prompt_version", "activate_prompt_version"]);
  expect(rpcLog[rpcLog.findIndex((c) => c.name === "create_prompt_version")].body).toEqual({ p_purpose: "PLAN", p_body: `${PLAN_BODY}\n（4版）` });
  expect(rpcLog.find((c) => c.name === "activate_prompt_version")?.body).toEqual({ p_id: "pv-PLAN-4" });
  expect(await hasNoHorizontalScroll(page)).toBe(true);
});

test("AC-002-08 必要な差し込み値が足りない・知らない差し込み値がある本文は、分かる文言で止まり、版は作られない", async ({ page }) => {
  const { rpcCalls } = await useMockSupabase(page, promptWorld());
  await page.goto("/settings/prompts/");
  await page.getByRole("textbox", { name: "本文" }).fill(PLAN_BODY.replace("{{limits}}", "{{unknownName}}"));
  await page.getByRole("button", { name: "新しい版として保存" }).click();
  await expect(page.getByText("プロンプトの本文に必要な差し込み値がありません: {{limits}}")).toBeVisible();
  await expect(page.getByText("プロンプトの本文に知らない差し込み値があります: {{unknownName}}")).toBeVisible();
  expect(rpcCalls).not.toContain("create_prompt_version");
});

test("AC-002-08 DB が差し込み値の違反（22023）で拒んだら、その文言を出し、有効な版は変わらない", async ({ page }) => {
  await useMockSupabase(page, promptWorld({
    failOnce: { create_prompt_version: { code: "22023", message: "プロンプトの本文に知らない差し込み値があります: {{newName}}" } },
  }));
  await page.goto("/settings/prompts/");
  await page.getByRole("textbox", { name: "本文" }).fill(`${PLAN_BODY}\n（直した）`);
  await page.getByRole("button", { name: "新しい版として保存" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "保存できませんでした" })).toContainText("知らない差し込み値があります: {{newName}}");
  await expect(versionRow(page, 3)).toHaveAttribute("data-active", "true");
  await expect(page.getByRole("region", { name: "版の一覧" }).locator("[data-version-no]")).toHaveCount(3);
});

test("AC-002-08 版は作れたが有効にできなかったら、版4は無効のまま残り、「有効にする」をもう一度出す", async ({ page }) => {
  const { rpcLog } = await useMockSupabase(page, promptWorld({
    failOnce: { activate_prompt_version: { code: "08006", message: "通信に失敗しました" } },
  }));
  await page.goto("/settings/prompts/");
  await page.getByRole("textbox", { name: "本文" }).fill(`${PLAN_BODY}\n（4版）`);
  await page.getByRole("button", { name: "新しい版として保存" }).click();

  await expect(page.getByRole("alert").filter({ hasText: "版4を有効にできませんでした" })).toBeVisible();
  await expect(versionRow(page, 4)).toBeVisible();
  await expect(versionRow(page, 4)).toHaveAttribute("data-active", "false");
  await expect(versionRow(page, 3)).toHaveAttribute("data-active", "true");

  await page.getByRole("button", { name: "版4を有効にする" }).click();
  await expect(versionRow(page, 4)).toHaveAttribute("data-active", "true");
  await expect(versionRow(page, 3)).toHaveAttribute("data-active", "false");
  expect(rpcLog.map((c) => c.name).filter((n) => /prompt_version/.test(n)))
    .toEqual(["create_prompt_version", "activate_prompt_version", "activate_prompt_version"]);
});

test("NFR-001-02 管理者の画面も 375px で横スクロールなし", async ({ page }) => {
  await useMockSupabase(page, promptWorld({ backgroundPhotos: photos(3) }));
  for (const path of ["/settings/backgrounds/", "/settings/style/", "/settings/prompts/"]) {
    await page.goto(path);
    await expect(page.getByRole("heading").first()).toBeVisible();
    expect(await hasNoHorizontalScroll(page)).toBe(true);
  }
});
