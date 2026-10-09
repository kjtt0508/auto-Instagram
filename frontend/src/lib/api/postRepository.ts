import type { PostgrestError } from "@supabase/supabase-js";
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
import type { PostStyleSettings } from "@/domain/post/PostStyleSettings";
import { BodyContent } from "@/domain/slide/BodyContent";
import { ClosingContent } from "@/domain/slide/ClosingContent";
import { CoverContent } from "@/domain/slide/CoverContent";
import { CoverText } from "@/domain/slide/CoverText";
import { MaterialImage } from "@/domain/slide/MaterialImage";
import { PictureBrief } from "@/domain/slide/PictureBrief";
import { Slide } from "@/domain/slide/Slide";
import { SlideList } from "@/domain/slide/SlideList";
import { SlideText } from "@/domain/slide/SlideText";
import { SETTINGS_COLUMNS, toSettings } from "./styleRepository";
import { supabase, unwrap, unwrapOptional } from "./supabase";

// 投稿の読み取り。post_current（導出ビュー）と各テーブルから Post を組み立てる（REQ-001 設計 5章。ORM は使わない）
export const POST_COLUMNS = "post_id, status, revision_id, format, media_source, caption, pr_category, genre_id, scheduled_at, "
  + "ig_media_id, permalink, published_at, last_failure_kind, last_failure_message";

export type PostRow = {
  post_id: string; status: string; revision_id: string; format: string; media_source?: string; caption: string; pr_category: string;
  genre_id: string | null; scheduled_at: string | null; ig_media_id: string | null; permalink: string | null;
  published_at: string | null; last_failure_kind: string | null; last_failure_message: string | null;
};

type MediaRow = {
  position: number; storage_path: string; width: number; height: number; byte_size: number;
  generation_id: string | null; candidate_position: number | null; style: string | null;
};

export function toPost(row: PostRow, media: PostMediaList = PostMediaList.empty(), template?: Post["content"]["template"]): Post {
  const status = PostStatus.from(row.status);
  return Post.restore({
    id: row.post_id, status,
    content: { revisionId: row.revision_id, format: PostFormat.from(row.format), caption: Caption.restore(row.caption),
      prCategory: PrCategory.from(row.pr_category), media, genreId: row.genre_id, template },
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
  if (row.media_source === "TEMPLATE") {
    const content = await findTemplateContent(row.revision_id);
    return toPost(row, PostMediaList.empty(), content ?? undefined);
  }
  // 投稿画像は生成画像の由来つきで読む（post_media_origin。REQ-005 設計 5章）
  const mediaRows = unwrap(await supabase().from("post_media_origin")
    .select("position, storage_path, width, height, byte_size, generation_id, candidate_position, style")
    .eq("revision_id", row.revision_id).order("position"));
  return toPost(row, PostMediaList.of((mediaRows as MediaRow[]).map(toMedia)));
}

/** テンプレートの投稿の版の中身（スライド構成・追加のハッシュタグ・使ったテンプレートの版と投稿の型の設定の版） */
export type TemplateContent = {
  slides: SlideList; templateVersion: string; settings: PostStyleSettings; additionalHashtags: string[];
  /** 元になった下書き案の生成（無ければ null）。修正指示の親になる */
  generationId: string | null;
};

type SlideRow = { id: string; position: number; role: string };
type CoverRow = { slide_id: string; target: string; keyword: string; annotation: string; closing_words: string; accent: string };
type BodyRow = { slide_id: string; heading: string; description: string; picture_prompt: string; needs_replacement: boolean };
type MaterialRow = { slide_id: string; storage_path: string; width: number; height: number; byte_size: number };

const rowsOf = async <T>(query: PromiseLike<{ data: unknown; error: PostgrestError | null }>) =>
  unwrap(await query) as unknown as T[];

/** テンプレートの投稿の版を読む。テンプレートの投稿でなければ null（スライド・文言・強調・素材画像・背景写真・ハッシュタグを読み、SlideList に戻す） */
export async function findTemplateContent(revisionId: string): Promise<TemplateContent | null> {
  const release = unwrapOptional(await supabase().from("revision_templates").select("template_version, style_settings_id")
    .eq("revision_id", revisionId).maybeSingle<{ template_version: string; style_settings_id: number }>());
  if (!release) return null;
  const settingsRow = unwrap(await supabase().from("post_style_settings").select(SETTINGS_COLUMNS)
    .eq("id", release.style_settings_id).maybeSingle<Parameters<typeof toSettings>[0]>());
  const [settings, slideRows, tagRows, generation, generated] = await Promise.all([
    toSettings(settingsRow),
    rowsOf<SlideRow>(supabase().from("post_slides").select("id, position, role").eq("revision_id", revisionId).order("position")),
    rowsOf<{ hashtag: string }>(supabase().from("revision_hashtags").select("hashtag").eq("revision_id", revisionId).order("position")),
    supabase().from("revision_generations").select("generation_id").eq("revision_id", revisionId).maybeSingle<{ generation_id: string }>(),
    rowsOf<{ position: number; generation_id: string; candidate_position: number; style: string }>(
      supabase().from("revision_generated_styles").select("position, generation_id, candidate_position, style")
        .eq("revision_id", revisionId).eq("origin", "MATERIAL")),
  ]);
  const ids = slideRows.map((s) => s.id);
  const [covers, bodies, emphases, materials, backgrounds] = await Promise.all([
    rowsOf<CoverRow>(supabase().from("cover_slides").select("slide_id, target, keyword, annotation, closing_words, accent").in("slide_id", ids)),
    rowsOf<BodyRow>(supabase().from("body_slides").select("slide_id, heading, description, picture_prompt, needs_replacement").in("slide_id", ids)),
    rowsOf<{ slide_id: string; seq: number; start_cp: number; length_cp: number }>(
      supabase().from("body_emphases").select("slide_id, seq, start_cp, length_cp").in("slide_id", ids).order("seq")),
    rowsOf<MaterialRow>(supabase().from("body_materials").select("slide_id, storage_path, width, height, byte_size").in("slide_id", ids)),
    rowsOf<{ slide_id: string; background_photo_id: string }>(supabase().from("cover_backgrounds").select("slide_id, background_photo_id").in("slide_id", ids)),
  ]);
  const photoIds = backgrounds.map((b) => b.background_photo_id);
  const photos = photoIds.length === 0 ? [] : await rowsOf<{ id: string; storage_path: string }>(
    supabase().from("background_photos").select("id, storage_path").in("id", photoIds));

  const slides = slideRows.map((slide) => {
    if (slide.role === "COVER") return Slide.createCover(coverOf(slide, covers, backgrounds, photos));
    if (slide.role === "BODY") return Slide.createBody(bodyOf(slide, { bodies, emphases, materials, generated }));
    return Slide.createClosing(ClosingContent.empty());
  });
  return {
    slides: SlideList.restore(slides), templateVersion: release.template_version, settings,
    additionalHashtags: tagRows.map((t) => t.hashtag), generationId: unwrapOptional(generation)?.generation_id ?? null,
  };
}

function coverOf(slide: SlideRow, covers: CoverRow[], backgrounds: { slide_id: string; background_photo_id: string }[],
  photos: { id: string; storage_path: string }[]): CoverContent {
  const cover = covers.find((c) => c.slide_id === slide.id);
  if (!cover) throw new Error("表紙の文言が見つかりません");
  const photoId = backgrounds.find((b) => b.slide_id === slide.id)?.background_photo_id;
  const photo = photos.find((p) => p.id === photoId);
  return CoverContent.of(CoverText.restore({ target: cover.target, keyword: cover.keyword, annotation: cover.annotation,
    closingWords: cover.closing_words, accentCode: cover.accent }), photo ? { photoId: photo.id, storagePath: photo.storage_path } : undefined);
}

function bodyOf(slide: SlideRow, rows: {
  bodies: BodyRow[]; emphases: { slide_id: string; start_cp: number; length_cp: number }[]; materials: MaterialRow[];
  generated: { position: number; generation_id: string; candidate_position: number; style: string }[];
}): BodyContent {
  const body = rows.bodies.find((b) => b.slide_id === slide.id);
  if (!body) throw new Error("中のスライドの文言が見つかりません");
  // 強調する語は、保存されたコードポイントの位置から語に戻す
  const chars = [...body.description];
  const words = rows.emphases.filter((e) => e.slide_id === slide.id).map((e) => chars.slice(e.start_cp, e.start_cp + e.length_cp).join(""));
  const material = rows.materials.find((m) => m.slide_id === slide.id);
  const origin = rows.generated.find((g) => g.position === slide.position);
  return BodyContent.of({
    text: SlideText.restore({ heading: body.heading, description: body.description, emphases: words }),
    brief: PictureBrief.restore({ prompt: body.picture_prompt, replacementNeeded: body.needs_replacement }),
    material: material ? MaterialImage.of({ storagePath: material.storage_path, width: material.width, height: material.height,
      byteSize: material.byte_size, generated: origin ? GeneratedImage.of({ generationId: origin.generation_id, candidatePosition: origin.candidate_position, styleCode: origin.style }) : undefined }) : undefined,
  });
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
