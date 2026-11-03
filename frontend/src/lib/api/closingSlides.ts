import { PastPostCover } from "@/domain/post/PastPostCover";
import type { Post } from "@/domain/post/Post";
import { ClosingContent } from "@/domain/slide/ClosingContent";
import type { SlideList } from "@/domain/slide/SlideList";
import { supabase, unwrap } from "./supabase";

// 投稿の表示・承認の画面で、最後のスライドに並べる画像を入れた構成を作る（REQ-007 BR-007-04, 05）。組み立ては SlideList / ClosingContent が行い、ここは記録を読んで渡すだけ

/** この版を承認した出来事（最新）が記録した過去の投稿の表紙（REQ-007 より前の承認だけ行がある）。承認されていなければ null */
async function recordedPastPosts(postId: string, revisionId: string): Promise<PastPostCover[] | null> {
  const events = unwrap(await supabase().from("post_events").select("id").eq("post_id", postId)
    .eq("event_type", "APPROVED").eq("revision_id", revisionId).order("id", { ascending: false }).limit(1)) as { id: number }[];
  if (events.length === 0) return null;
  const rows = unwrap(await supabase().from("approval_past_posts").select("past_post_id, cover_storage_path")
    .eq("approval_event_id", events[0].id).order("position")) as { past_post_id: string; cover_storage_path: string }[];
  return rows.map((r) => PastPostCover.restore(r.past_post_id, r.cover_storage_path));
}

/**
 * テンプレートの投稿を見せる構成。承認前（下書き・承認待ち）は、投稿の版が記録した設定の版の最後のスライドの画像。
 * 承認後は承認の記録から作る（過去の投稿の表紙があればそれ、無ければ記録した設定の版の画像）ので、画像化と同じ画像になる。
 * テンプレートの投稿でなければ null
 */
export async function slidesForView(post: Post): Promise<SlideList | null> {
  const template = post.content.template;
  if (!template) return null;
  const recorded = post.status.drawsFromApproval() ? await recordedPastPosts(post.id, post.content.revisionId) : null;
  return recorded
    ? template.slides.withClosing(ClosingContent.fromApproval(recorded, template.settings.closingImages()))
    : template.slides.withClosingImagesOf(template.settings);
}
