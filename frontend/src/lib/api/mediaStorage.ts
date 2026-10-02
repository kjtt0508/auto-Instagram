import type { Tenant } from "@/domain/tenant/Tenant";
import { supabase } from "./supabase";

// 下書きの画像（非公開バケット uploads-private。自団体のパスだけ書けて読める。01_DB設計.md 4章）
const BUCKET = "uploads-private";
const SIGNED_URL_SECONDS = 60 * 60;

/** 変換済みの JPEG を保存し、保存先のパスを返す */
export async function uploadDraftImage(tenant: Tenant, jpeg: Blob): Promise<string> {
  const path = tenant.uploadPathFor(crypto.randomUUID());
  const { error } = await supabase().storage.from(BUCKET).upload(path, jpeg, { contentType: "image/jpeg" });
  if (error) throw new Error(`画像を保存できませんでした: ${error.message}`);
  return path;
}

/** 画面に表示するための期限付き URL（保存先のパス → URL） */
export async function viewUrls(paths: readonly string[]): Promise<Map<string, string>> {
  if (paths.length === 0) return new Map();
  const { data, error } = await supabase().storage.from(BUCKET).createSignedUrls([...paths], SIGNED_URL_SECONDS);
  if (error) throw new Error(`画像を読み込めませんでした: ${error.message}`);
  return new Map(data.flatMap((d) => (d.path && d.signedUrl ? [[d.path, d.signedUrl] as const] : [])));
}
