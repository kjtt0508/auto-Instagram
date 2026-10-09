import type { Tenant } from "@/domain/tenant/Tenant";
import { supabase } from "./supabase";

// 下書きの画像（非公開バケット uploads-private。自団体のパスだけ書けて読める。01_DB設計.md 4章）
const BUCKET = "uploads-private";
const SIGNED_URL_SECONDS = 60 * 60;

/** 推測できないファイル名（UUID v4）。crypto.randomUUID は https でしか使えないので、無ければ乱数から作る */
function newFileId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** 変換済みの JPEG を保存し、保存先のパスを返す */
export async function uploadDraftImage(tenant: Tenant, jpeg: Blob): Promise<string> {
  const path = tenant.uploadPathFor(newFileId());
  const { error } = await supabase().storage.from(BUCKET).upload(path, jpeg, { contentType: "image/jpeg" });
  if (error) throw new Error(`画像を保存できませんでした: ${error.message}`);
  return path;
}

async function uploadTo(path: string, image: Blob, contentType: string): Promise<string> {
  const { error } = await supabase().storage.from(BUCKET).upload(path, image, { contentType });
  if (error) throw new Error(`画像を保存できませんでした: ${error.message}`);
  return path;
}

/** 変換済みの JPEG を背景写真の保存先（管理者だけが書ける）に保存し、パスを返す */
export function uploadBackgroundPhoto(tenant: Tenant, jpeg: Blob): Promise<string> {
  return uploadTo(tenant.backgroundPathFor(newFileId()), jpeg, "image/jpeg");
}

/** 変換済みの PNG を投稿の型の設定のロゴの保存先（管理者だけが書ける）に保存し、パスを返す */
export function uploadStyleLogo(tenant: Tenant, png: Blob): Promise<string> {
  return uploadTo(tenant.logoPathFor(newFileId()), png, "image/png");
}

/** 画面に表示するための期限付き URL（保存先のパス → URL） */
export async function viewUrls(paths: readonly string[]): Promise<Map<string, string>> {
  if (paths.length === 0) return new Map();
  const { data, error } = await supabase().storage.from(BUCKET).createSignedUrls([...paths], SIGNED_URL_SECONDS);
  if (error) throw new Error(`画像を読み込めませんでした: ${error.message}`);
  return new Map(data.flatMap((d) => (d.path && d.signedUrl ? [[d.path, d.signedUrl] as const] : [])));
}
