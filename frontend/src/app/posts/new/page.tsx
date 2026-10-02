"use client";

import { PostEditor } from "@/components/post/PostEditor";

/** S-03 投稿を作る */
export default function NewPostPage() {
  return <PostEditor postId={null} title="新規投稿" />;
}
