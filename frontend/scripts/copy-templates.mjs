// 画面のビルド後に、リポジトリの templates/（テンプレートの版ごとのファイル。ADR-0010）を静的出力の out/templates/ にコピーする。
// プレビューの iframe が /templates/<版>/index.html を読む。コピーするのは版のフォルダだけ（古い版も残す）
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "..", "templates");
const target = join(root, "out", "templates");

if (!existsSync(source)) throw new Error(`templates/ が見つかりません: ${source}`);
rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
console.log(`templates/ を ${target} にコピーしました`);
