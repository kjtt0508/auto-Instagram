"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { PostEditor } from "@/components/post/PostEditor";
import { LargeTitle, Placeholder } from "@/components/ui/Grouped";
import type { Post } from "@/domain/post/Post";
import { findPost } from "@/lib/api/postRepository";

/** S-03 投稿を編集する（/posts/edit/?id=…）。編集できるのは下書きだけ */
export default function EditPostPage() {
  return (
    <>
      <LargeTitle>投稿を編集</LargeTitle>
      <Suspense fallback={<Placeholder>読み込み中…</Placeholder>}><EditPost /></Suspense>
    </>
  );
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
  const { format, media, caption, prCategory, genreId } = post.content;
  return <PostEditor postId={post.id} initial={{ format, media, captionText: caption.text, prCategory, genreId }} />;
}
