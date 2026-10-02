"use client";

import { PostEditor } from "@/components/post/PostEditor";
import { LargeTitle } from "@/components/ui/Grouped";

/** S-03 投稿を作る */
export default function NewPostPage() {
  return (
    <>
      <LargeTitle>新規投稿</LargeTitle>
      <PostEditor postId={null} />
    </>
  );
}
