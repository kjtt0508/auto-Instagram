import type { PostFormat } from "@/domain/post/PostFormat";
import type { PostMediaList } from "@/domain/post/PostMediaList";
import type { PrCategory } from "@/domain/post/PrCategory";
import type { ScheduledAt } from "@/domain/post/ScheduledAt";
import { check, supabase, unwrap } from "./supabase";

// 投稿の状態を変える操作。書き込みはすべて RPC（REQ-001 設計 4章）。業務判断は呼ぶ前にドメインで済ませる

export type DraftContent = {
  format: PostFormat; media: PostMediaList; captionText: string; prCategory: PrCategory; genreId: string | null;
};

type SavedRow = { post_id: string; revision_id: string };

/** 下書きを保存する（新しい版を作る）。新規なら postId は null。保存した投稿IDと版IDを返す */
export async function saveDraft(postId: string | null, draft: DraftContent): Promise<{ postId: string; revisionId: string }> {
  const revision = {
    format: draft.format.code, mediaSource: "UPLOAD", caption: draft.captionText, prCategory: draft.prCategory.code,
    genreId: draft.genreId ?? "", media: draft.media.items().map((m) => m.toRevisionMedia()),
  };
  // 保存した版IDは RPC から受け取る（読み直すと、その間に他の人が保存した版を受け取ってしまう）
  const rows = unwrap(await supabase().rpc("save_post_revision", { p_post: postId, p_revision: revision })) as SavedRow[];
  return { postId: rows[0].post_id, revisionId: rows[0].revision_id };
}

export async function requestApproval(postId: string, revisionId: string): Promise<void> {
  check(await supabase().rpc("request_approval", { p_post: postId, p_revision: revisionId }));
}

export async function approve(postId: string, revisionId: string, scheduledAt: ScheduledAt): Promise<void> {
  check(await supabase().rpc("approve_post",
    { p_post: postId, p_revision: revisionId, p_scheduled_at: scheduledAt.toISOString() }));
}

export async function retry(postId: string, scheduledAt: ScheduledAt): Promise<void> {
  check(await supabase().rpc("retry_post", { p_post: postId, p_scheduled_at: scheduledAt.toISOString() }));
}

export async function sendBackToDraft(postId: string): Promise<void> {
  check(await supabase().rpc("send_back_to_draft", { p_post: postId }));
}

export async function cancelSchedule(postId: string): Promise<void> {
  check(await supabase().rpc("cancel_schedule", { p_post: postId }));
}

export async function returnToDraft(postId: string): Promise<void> {
  check(await supabase().rpc("return_to_draft", { p_post: postId }));
}

export async function discard(postId: string): Promise<void> {
  check(await supabase().rpc("discard_post", { p_post: postId }));
}
