import { CaptionFooter } from "@/domain/post/CaptionFooter";
import { FixedHashtags } from "@/domain/post/FixedHashtags";
import { PostStyleSettings } from "@/domain/post/PostStyleSettings";
import { supabase, unwrap, unwrapOptional } from "./supabase";

// 投稿の型の設定と背景写真の読み取り（REQ-002 設計 5章）。読むだけで、書き込みは管理画面（S-14・S-15）の RPC

type SettingsRow = {
  id: number; tenant_id: string; version: number; band_text: string; cover_targets: string[]; closing_message: string;
  account_introduction: string; caption_footer: string; fixed_hashtags: string[];
};

export const SETTINGS_COLUMNS = "id, tenant_id, version, band_text, cover_targets, closing_message, account_introduction, caption_footer, fixed_hashtags";

export async function toSettings(row: SettingsRow): Promise<PostStyleSettings> {
  const logo = unwrapOptional(await supabase().from("post_style_logos").select("storage_path")
    .eq("style_settings_id", row.id).maybeSingle<{ storage_path: string }>());
  return PostStyleSettings.of({
    tenantId: row.tenant_id, version: row.version, bandText: row.band_text, coverTargets: row.cover_targets,
    closingMessage: row.closing_message, accountIntroduction: row.account_introduction,
    captionFooter: CaptionFooter.of(row.caption_footer), fixedHashtags: FixedHashtags.of(row.fixed_hashtags),
    logoStoragePath: logo?.storage_path,
  });
}

/** 投稿の型の設定の現在の版。管理者がまだ設定していなければ null */
export async function currentStyleSettings(): Promise<PostStyleSettings | null> {
  const row = unwrapOptional(await supabase().from("post_style_settings_current").select(SETTINGS_COLUMNS).maybeSingle<SettingsRow>());
  return row ? toSettings(row) : null;
}

/** 背景写真（表紙に使う写真。「使わない」にしていないもの） */
export type BackgroundPhoto = { id: string; storagePath: string; description: string };

export async function usableBackgroundPhotos(): Promise<BackgroundPhoto[]> {
  const rows = unwrap(await supabase().from("usable_background_photos").select("id, storage_path, description")
    .order("registered_at", { ascending: false })) as { id: string; storage_path: string; description: string }[];
  return rows.map((r) => ({ id: r.id, storagePath: r.storage_path, description: r.description }));
}
