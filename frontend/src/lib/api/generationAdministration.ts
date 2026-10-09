import { PromptPurpose } from "@/domain/draft/PromptPurpose";
import { PromptVersion } from "@/domain/draft/PromptVersion";
import { CaptionFooter } from "@/domain/post/CaptionFooter";
import { FixedHashtags } from "@/domain/post/FixedHashtags";
import { check, supabase, unwrap } from "./supabase";

// 下書き生成の管理（管理者だけ。S-14 背景写真・S-15 投稿の型の設定・S-10 プロンプト版。BR-002-07, 17, 21）。書き込みは RPC が管理者かを確かめる

/** 背景写真を登録する（保存先は uploads-private/{団体}/backgrounds/…。使う写真が30枚なら DB が拒む） */
export async function registerBackgroundPhoto(storagePath: string, description: string): Promise<void> {
  check(await supabase().rpc("register_background_photo", { p_storage_path: storagePath, p_description: description.trim() }));
}

/** 背景写真を「使わない」にする（消さない。既存の投稿の画像化には使える。AC-002-24） */
export async function retireBackgroundPhoto(id: string): Promise<void> {
  check(await supabase().rpc("retire_background_photo", { p_id: id }));
}

/** 管理者が入力する投稿の型の設定（保存すると新しい版になる） */
export type StyleSettingsInput = {
  bandText: string; coverTargets: readonly string[]; closingMessage: string; accountIntroduction: string;
  captionFooter: string; fixedHashtags: readonly string[]; logoStoragePath?: string;
};

/** 投稿の型の設定を新しい版として保存する。戻り値は新しい版の番号。入力は PostStyleSettings.violationsOfInput で検査済みの前提 */
export async function saveStyleSettings(input: StyleSettingsInput): Promise<number> {
  const data = unwrap(await supabase().rpc("save_post_style_settings", {
    p_band_text: input.bandText, p_cover_targets: [...input.coverTargets], p_closing_message: input.closingMessage,
    p_account_introduction: input.accountIntroduction, p_caption_footer: CaptionFooter.of(input.captionFooter).text,
    p_fixed_hashtags: FixedHashtags.of(input.fixedHashtags).texts(), p_logo_storage_path: input.logoStoragePath ?? null,
  }));
  return Number(data);
}

/** 用途ごとのプロンプト版（新しい版が先）と、有効な版の ID */
export type PromptVersions = { versions: PromptVersion[]; activeId: string | undefined };

export async function promptVersionsOf(purpose: PromptPurpose): Promise<PromptVersions> {
  const rows = unwrap(await supabase().from("prompt_versions").select("id, purpose, version_no, body")
    .eq("purpose", purpose.code).order("version_no", { ascending: false })) as { id: string; purpose: string; version_no: number; body: string }[];
  const active = unwrap(await supabase().from("active_prompt_versions").select("prompt_version_id")
    .eq("purpose", purpose.code)) as { prompt_version_id: string }[];
  return {
    versions: rows.map((r) => PromptVersion.restore({ id: r.id, purpose: PromptPurpose.from(r.purpose), versionNo: r.version_no, body: r.body })),
    activeId: active[0]?.prompt_version_id,
  };
}

/** 新しい版を作る（有効にはしない）。差し込み値の違反は 22023 のメッセージで返る */
export async function createPromptVersion(purpose: PromptPurpose, body: string): Promise<string> {
  return String(unwrap(await supabase().rpc("create_prompt_version", { p_purpose: purpose.code, p_body: body })));
}

export async function activatePromptVersion(id: string): Promise<void> {
  check(await supabase().rpc("activate_prompt_version", { p_id: id }));
}
