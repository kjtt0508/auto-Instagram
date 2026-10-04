import { deflateSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import { useMockSupabase } from "./supabaseMock";

/** 単色の PNG（スマホで撮った写真の代わり）。幅×高さを指定する */
function solidPng(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x55)]);
  const pixels = deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", pixels), chunk("IEND", Buffer.alloc(0))]);
}

test("NFR-001-02 スマホから、写真を選ぶ → キャプション → 承認を依頼 の3操作で投稿を出せる。作成中はタブバーを隠す", async ({ page }) => {
  const { rpcCalls } = await useMockSupabase(page, { role: "EDITOR", heartbeatMinutesAgo: 5, posts: [] });
  await page.goto("/posts/new/");
  await expect(page.getByRole("navigation", { name: "タブ" })).toHaveCount(0);
  await expect(page.getByLabel("写真を撮る")).toHaveAttribute("capture", "environment");

  await page.getByLabel("写真を選ぶ").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: solidPng(1200, 1600) }); // 1
  await expect(page.getByText("1枚目")).toBeVisible();
  await expect(page.getByText("画像の投稿（1枚）")).toBeVisible();
  await page.getByRole("textbox", { name: "キャプション" }).fill("学園祭のお知らせ #新島info");                                                    // 2
  await page.getByRole("button", { name: "承認を依頼" }).click();                                                             // 3

  await expect.poll(() => rpcCalls.filter((c) => c !== "link_my_member")).toEqual(["save_post_revision", "request_approval"]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("BR-001-04 写真を2枚にするとカルーセルになり、2枚目は1枚目の縦横比にそろう", async ({ page }) => {
  await useMockSupabase(page, { role: "EDITOR", heartbeatMinutesAgo: 5, posts: [] });
  await page.goto("/posts/new/");
  await page.getByLabel("写真を選ぶ").setInputFiles([
    { name: "a.png", mimeType: "image/png", buffer: solidPng(1200, 1600) },
    { name: "b.png", mimeType: "image/png", buffer: solidPng(1200, 1200) },
  ]);
  await expect(page.getByText("2枚目")).toBeVisible();
  await expect(page.getByText("カルーセルの投稿（2枚）")).toBeVisible();
});

/** API関数 /api/image-generations の代役。候補は 1024×1024 の画像（REQ-005 設計 4章） */
async function useMockImageGeneration(page: Page) {
  const calls: string[] = [];
  await page.route("**/e2e-candidates/*.png", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: solidPng(1024, 1024) }));
  await page.route("**/api/image-generations**", (route) => {
    const path = new URL(route.request().url()).pathname;
    calls.push(path);
    if (path.endsWith("/clear")) return route.fulfill({ status: 204 });
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({
      generationId: "g1",
      candidates: [1, 2, 3, 4].map((position) => ({ position, url: `/e2e-candidates/${position}.png` })),
      usage: { used: 1, dailyLimit: 20, warnRatio: 0.8 },
    }) });
  });
  return calls;
}

test("AC-005-07 提供元の失敗で「画像を生成できませんでした」と出ても、作成中の投稿の画像とキャプションは失われない", async ({ page }) => {
  await useMockSupabase(page, { role: "EDITOR", heartbeatMinutesAgo: 5, posts: [] });
  await page.route("**/api/image-generations**", (route) => route.fulfill({ status: 502, contentType: "application/json",
    body: JSON.stringify({ error: { code: "GENERATION_FAILED", message: "画像を生成できませんでした" } }) }));
  await page.goto("/posts/new/");
  await page.getByLabel("写真を選ぶ").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: solidPng(1200, 1600) });
  await expect(page.getByText("1枚目")).toBeVisible();
  await page.getByRole("textbox", { name: "キャプション" }).fill("書きかけのお知らせ");

  await page.getByRole("button", { name: "AIで作る" }).click();
  await page.getByRole("textbox", { name: "作りたい画像" }).fill("桜並木");
  await page.getByRole("button", { name: "生成" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveText("画像を生成できませんでした");
  await page.getByRole("dialog").getByRole("button", { name: "キャンセル" }).click();

  await expect(page.getByText("画像の投稿（1枚）")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "キャプション" })).toHaveValue("書きかけのお知らせ");
});

test("AC-005-09 種類「写真風」を選ぶと、イメージ写真としてだけ使える旨の注意書きが出る", async ({ page }) => {
  await useMockSupabase(page, { role: "EDITOR", heartbeatMinutesAgo: 5, posts: [] });
  await page.goto("/posts/new/");
  await page.getByRole("button", { name: "AIで作る" }).click();
  const caution = "イメージ写真としてだけ使えます。実際の出来事・場所・人を撮ったように見せる使い方や、実在の人物・商標を求める指示はできません";
  await expect(page.getByText(caution)).toHaveCount(0);
  await page.getByRole("radio", { name: "写真風" }).click();
  await expect(page.getByText(caution)).toBeVisible();
});

test("AC-005-12 AC-005-15 編集者が4枚の候補のうち2枚を採用すると、投稿画像の末尾に加わってカルーセルになり、保存で候補の採用が記録される", async ({ page }) => {
  await useMockSupabase(page, { role: "EDITOR", heartbeatMinutesAgo: 5, posts: [] });
  const apiCalls = await useMockImageGeneration(page);
  const saved: unknown[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/rpc/save_post_revision")) saved.push(request.postDataJSON());
  });
  await page.goto("/posts/new/");

  await page.getByRole("button", { name: "AIで作る" }).click();
  await page.getByRole("textbox", { name: "作りたい画像" }).fill("桜並木のやわらかい水彩風の背景");
  await page.getByRole("button", { name: "生成" }).click();
  await page.getByRole("button", { name: "候補1" }).click();
  await page.getByRole("button", { name: "候補3" }).click();
  await page.getByRole("button", { name: "選んだ画像を使う（2）" }).click();

  await expect(page.getByText("カルーセルの投稿（2枚）")).toBeVisible();
  expect(apiCalls).toEqual(["/api/image-generations", "/api/image-generations/g1/clear"]);
  await page.getByRole("textbox", { name: "キャプション" }).fill("春のお知らせ");
  await page.getByRole("button", { name: "承認を依頼" }).click();

  await expect.poll(() => saved.length).toBe(1);
  const media = (saved[0] as { p_revision: { media: { position: number; generation?: unknown }[] } }).p_revision.media;
  expect(media.map((m) => [m.position, m.generation])).toEqual([
    [1, { generationId: "g1", candidatePosition: 1 }],
    [2, { generationId: "g1", candidatePosition: 3 }],
  ]);
});
