"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSession } from "@/components/session/SessionGate";
import { Button } from "@/components/ui/Button";
import { GroupedSection } from "@/components/ui/Grouped";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Caption } from "@/domain/post/Caption";
import { Post } from "@/domain/post/Post";
import { PostFormat } from "@/domain/post/PostFormat";
import { PostMediaList } from "@/domain/post/PostMediaList";
import { PrCategory } from "@/domain/post/PrCategory";
import { requestApproval, saveDraft, type DraftContent } from "@/lib/api/postCommands";
import { CaptionField } from "./CaptionField";
import { MediaPicker } from "./MediaPicker";

const EMPTY_DRAFT: DraftContent = {
  format: PostFormat.FEED_IMAGE, media: PostMediaList.empty(), captionText: "", prCategory: PrCategory.NONE, genreId: null,
};

/** S-03 投稿を作る・編集する: ①投稿種別 ②画像 ③キャプション ④PR区分 ⑤保存・承認依頼 */
export function PostEditor({ postId, initial }: { postId: string | null; initial?: DraftContent }) {
  const { tenant } = useSession();
  const router = useRouter();
  const [draft, setDraft] = useState<DraftContent>(initial ?? EMPTY_DRAFT);
  const [errors, setErrors] = useState<string[]>([]);
  const update = (patch: Partial<DraftContent>) => setDraft({ ...draft, ...patch });

  const save = async (alsoRequestApproval: boolean) => {
    const violations = alsoRequestApproval
      ? Post.violationsForApprovalRequest(draft, tenant.prLabel) : Caption.violationsOf(draft.captionText);
    if (violations.length > 0) return setErrors(violations);
    try {
      const saved = await saveDraft(postId, draft);
      if (alsoRequestApproval) await requestApproval(saved.postId, saved.revisionId);
      router.push(`/posts/view/?id=${encodeURIComponent(saved.postId)}`);
    } catch (e) {
      setErrors([(e as Error).message]);
    }
  };

  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <GroupedSection title="投稿種別">
        <div className="p-2"><SegmentedControl label="投稿種別" options={PostFormat.all()} selected={draft.format} onSelect={(format) => update({ format })} /></div>
      </GroupedSection>
      <MediaPicker tenant={tenant} format={draft.format} media={draft.media} onChange={(media) => update({ media })} />
      <CaptionField value={draft.captionText} onChange={(captionText) => update({ captionText })} />
      <GroupedSection title="PR区分"
        footer={draft.prCategory.requiresLabel() ? `公開時にキャプションの先頭へ「${tenant.prLabel.trim()}」を付けます` : "対価を受けた広告ならPR案件を選びます"}>
        <div className="p-2"><SegmentedControl label="PR区分" options={PrCategory.all()} selected={draft.prCategory} onSelect={(prCategory) => update({ prCategory })} /></div>
      </GroupedSection>
      {errors.length > 0 && (
        <ul className="mt-4 space-y-1 px-4">{errors.map((e) => <li key={e} role="alert" className="text-[13px] text-destructive">{e}</li>)}</ul>
      )}
      <div className="mt-6 space-y-2">
        <Button variant="filled" block onClick={() => save(true)}>承認を依頼</Button>
        <Button variant="plain" block onClick={() => save(false)}>下書き保存</Button>
      </div>
    </form>
  );
}
