import { Caption } from "@/domain/post/Caption";
import { FailureReason } from "@/domain/post/FailureReason";
import { GeneratedImage } from "@/domain/post/GeneratedImage";
import { Post } from "@/domain/post/Post";
import { PostEvent } from "@/domain/post/PostEvent";
import { PostFormat } from "@/domain/post/PostFormat";
import { PostMedia } from "@/domain/post/PostMedia";
import { PostMediaList } from "@/domain/post/PostMediaList";
import { PostStatus } from "@/domain/post/PostStatus";
import { PrCategory } from "@/domain/post/PrCategory";
import { PublishResult } from "@/domain/post/PublishResult";
import { ScheduledAt } from "@/domain/post/ScheduledAt";
import { supabase, unwrap, unwrapOptional } from "./supabase";

// 投稿の読み取り。post_current（導出ビュー）と各テーブルから Post を組み立てる（REQ-001 設計 5章。ORM は使わない）
export const POST_COLUMNS = "post_id, status, revision_id, format, caption, pr_category, genre_id, scheduled_at, "
  + "ig_media_id, permalink, published_at, last_failure_kind, last_failure_message";

export type PostRow = {
  post_id: string; status: string; revision_id: string; format: string; caption: string; pr_category: string;
  genre_id: string | null; scheduled_at: string | null; ig_media_id: string | null; permalink: string | null;
  published_at: string | null; last_failure_kind: string | null; last_failure_message: string | null;
};

type MediaRow = {
  position: number; storage_path: string; width: number; height: number; byte_size: number;
  generation_id: string | null; candidate_position: number | null; style: string | null;
};

export function toPost(row: PostRow, media: PostMediaList = PostMediaList.empty()): Post {
  const status = PostStatus.from(row.status);
  return Post.restore({
    id: row.post_id, status,
    content: { revisionId: row.revision_id, format: PostFormat.from(row.format), caption: Caption.restore(row.caption),
      prCategory: PrCategory.from(row.pr_category), media, genreId: row.genre_id },
    outcome: {
      scheduledAt: row.scheduled_at ? ScheduledAt.restore(new Date(row.scheduled_at)) : null,
      result: row.ig_media_id && row.published_at
        ? PublishResult.of(row.ig_media_id, row.permalink ?? "", new Date(row.published_at)) : null,
      failure: status.isFailed() && row.last_failure_message
        ? FailureReason.of(row.last_failure_kind ?? "UNKNOWN", row.last_failure_message) : null,
    },
  });
}

/** 投稿1件（最新の版の画像つき）。見つからなければ null（他団体の投稿は RLS で見えない） */
export async function findPost(postId: string): Promise<Post | null> {
  const row = unwrapOptional(await supabase().from("post_current").select(POST_COLUMNS).eq("post_id", postId)
    .maybeSingle<PostRow>());
  if (!row) return null;
  // 投稿画像は生成画像の由来つきで読む（post_media_origin。REQ-005 設計 5章）
  const mediaRows = unwrap(await supabase().from("post_media_origin")
    .select("position, storage_path, width, height, byte_size, generation_id, candidate_position, style")
    .eq("revision_id", row.revision_id).order("position"));
  return toPost(row, PostMediaList.of((mediaRows as MediaRow[]).map(toMedia)));
}

function toMedia(row: MediaRow): PostMedia {
  const generated = row.generation_id && row.candidate_position && row.style
    ? GeneratedImage.of({ generationId: row.generation_id, candidatePosition: row.candidate_position, styleCode: row.style }) : null;
  return PostMedia.of({ position: row.position, storagePath: row.storage_path, width: row.width,
    height: row.height, bytes: row.byte_size, generated });
}

/** 投稿履歴（古い順） */
export async function postHistory(postId: string): Promise<PostEvent[]> {
  const rows = unwrap(await supabase().from("post_events")
    .select("event_type, to_status, occurred_at, note, actor:members(display_name)").eq("post_id", postId).order("id"));
  return (rows as unknown as EventRow[]).map((r) => PostEvent.restore({
    kindCode: r.event_type, toStatusCode: r.to_status, occurredAt: new Date(r.occurred_at),
    actorName: r.actor?.display_name ?? null, note: r.note,
  }));
}

type EventRow = { event_type: string; to_status: string; occurred_at: string; note: string | null;
  actor: { display_name: string } | null };
