"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { PostEditor } from "@/components/post/PostEditor";
import { Placeholder } from "@/components/ui/Grouped";
import type { Post } from "@/domain/post/Post";
import { TemplatePostEditor } from "@/components/post/TemplatePostEditor";
import { EMPTY_TEMPLATE_WORK } from "@/lib/api/templateDraftAutosave";
import { findPost, findTemplateContent, type TemplateContent } from "@/lib/api/postRepository";

/** AIで作った投稿の編集（スライド・キャプションを直して保存し直す）。元の生成を覚えているので、修正指示も使える */
function TemplateEdit({ post }: { post: Post }) {
  const [content, setContent] = useState<TemplateContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    findTemplateContent(post.content.revisionId).then(setContent, (e: Error) => setError(e.message));
  }, [post.content.revisionId]);
  if (error) return <Placeholder tone="error">{error}</Placeholder>;
  if (!content) return <Placeholder>読み込み中…</Placeholder>;
  return <TemplatePostEditor postId={post.id} title="投稿を編集" initial={{
    ...EMPTY_TEMPLATE_WORK, slides: content.slides, generationId: content.generationId, materialBytes: content.materialBytes,
    captionText: post.content.caption.text, hashtagText: content.additionalHashtags.join(" "), prCategory: post.content.prCategory,
  }} />;
}

/** S-03 投稿を編集する（/posts/edit/?id=…）。編集できるのは下書きだけ */
export default function EditPostPage() {
  return <Suspense fallback={<Placeholder>読み込み中…</Placeholder>}><EditPost /></Suspense>;
}

function EditPost() {
  const id = useSearchParams().get("id") ?? "";
  const [post, setPost] = useState<Post | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    findPost(id).then(setPost, (e: Error) => setError(e.message));
  }, [id]);

  if (error) return <Placeholder tone="error">{error}</Placeholder>;
  if (post === undefined) return <Placeholder>読み込み中…</Placeholder>;
  if (post === null) return <Placeholder>投稿が見つかりません</Placeholder>;
  if (!post.canEdit()) return <Placeholder>この投稿は{post.status.label}のため編集できません</Placeholder>;
  const { format, media, caption, prCategory, genreId, template } = post.content;
  if (template) return <TemplateEdit post={post} />;
  return <PostEditor postId={post.id} title="投稿を編集" initial={{ format, media, captionText: caption.text, prCategory, genreId }} />;
}
