import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

// ブラウザに配る静的出力（out/）を調べる。E2E の webServer が直前に作ったものを読む
const OUT = join(__dirname, "..", "out");

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)]);
}

test("NFR-005-01 画像生成の提供元と Gemini はブラウザから呼ばない（静的出力に呼び出し先・鍵の名前が無い）", () => {
  const scripts = filesUnder(OUT).filter((f) => /\.(js|html)$/.test(f)).map((f) => readFileSync(f, "utf8"));
  expect(scripts.length).toBeGreaterThan(0);
  for (const forbidden of ["generativelanguage.googleapis.com", "GEMINI_API_KEY", "SUPABASE_SERVICE_ROLE_KEY", "@cf/black-forest-labs"]) {
    expect(scripts.some((s) => s.includes(forbidden)), forbidden).toBe(false);
  }
});
