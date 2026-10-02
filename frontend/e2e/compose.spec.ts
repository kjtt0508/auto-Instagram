import { deflateSync } from "node:zlib";
import { expect, test } from "@playwright/test";
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
