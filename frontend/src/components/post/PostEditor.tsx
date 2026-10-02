"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSession } from "@/components/session/SessionGate";
import { Button } from "@/components/ui/Button";
import { GroupedSection } from "@/components/ui/Grouped";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Caption } from "@/domain/post/Caption";
import { Post } from "@/domain/post/Post";
import { PostMediaList } from "@/domain/post/PostMediaList";
import { PrCategory } from "@/domain/post/PrCategory";
import { forgetNewDraft, recallNewDraft, rememberNewDraft } from "@/lib/api/draftAutosave";
import { requestApproval, saveDraft, type DraftContent } from "@/lib/api/postCommands";
import { CaptionField } from "./CaptionField";
import { MediaPicker } from "./MediaPicker";

const EMPTY_DRAFT: DraftContent = {
  format: PostMediaList.empty().format(), media: PostMediaList.empty(), captionText: "", prCategory: PrCategory.NONE, genreId: null,
};

/**
 * S-03 投稿を作る・編集する（スマホからの投稿が主）: ①画像（撮る・選ぶ）②キャプション ③PR区分。
 * 投稿種別は画像の枚数で決まる。保存・承認依頼は画面下に固定する。新規の入力は端末に一時保存する
 */
export function PostEditor({ postId, initial, title }: { postId: string | null; initial?: DraftContent; title: string }) {
  const { tenant } = useSession();
  const router = useRouter();
  // 新規なら端末に一時保存した入力から始める（この画面はログイン確認後にブラウザでだけ描かれる）
  const [recalled] = useState(() => (postId === null ? recallNewDraft() : null));
  const [draft, setDraft] = useState<DraftContent>(() =>
    initial ?? (recalled ? { ...EMPTY_DRAFT, ...recalled, format: recalled.media.format() } : EMPTY_DRAFT));
  const [restored, setRestored] = useState(recalled !== null);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const update = (patch: Partial<DraftContent>) => {
    const next = { ...draft, ...patch };
    const updated = { ...next, format: next.media.format() };
    setDraft(updated);
    if (postId === null) rememberNewDraft(updated);
  };

  const save = async (alsoRequestApproval: boolean) => {
    const violations = alsoRequestApproval
      ? Post.violationsForApprovalRequest(draft, tenant.prLabel) : Caption.violationsOf(draft.captionText);
    if (violations.length > 0) return setErrors(violations);
    setSaving(true);
    try {
      const saved = await saveDraft(postId, draft);
      if (alsoRequestApproval) await requestApproval(saved.postId, saved.revisionId);
      forgetNewDraft();
      router.push(`/posts/view/?id=${encodeURIComponent(saved.postId)}`);
    } catch (e) {
      setErrors([(e as Error).message]);
      setSaving(false);
    }
  };

  const discardRestored = () => {
    forgetNewDraft();
    setDraft(EMPTY_DRAFT);
    setRestored(false);
  };

  return (
    <form onSubmit={(e) => e.preventDefault()} className="pb-24">
      <NavigationBar title={title} onCancel={() => router.back()} />
      {restored && (
        <p className="mt-2 flex items-center justify-between rounded-cell bg-cell px-4 py-2 text-[15px]">
          前回の入力を復元しました
          <button type="button" onClick={discardRestored} className="min-h-9 px-2 text-destructive">消す</button>
        </p>
      )}
      <MediaPicker tenant={tenant} media={draft.media} onChange={(media) => update({ media })} />
      <CaptionField value={draft.captionText} onChange={(captionText) => update({ captionText })} />
      <GroupedSection title="PR区分"
        footer={draft.prCategory.requiresLabel() ? `公開時にキャプションの先頭へ「${tenant.prLabel.trim()}」を付けます` : "対価を受けた広告ならPR案件を選びます"}>
        <div className="p-2"><SegmentedControl label="PR区分" options={PrCategory.all()} selected={draft.prCategory} onSelect={(prCategory) => update({ prCategory })} /></div>
      </GroupedSection>
      {errors.length > 0 && (
        <ul className="mt-4 space-y-1 px-4">{errors.map((e) => <li key={e} role="alert" className="text-[15px] text-destructive">{e}</li>)}</ul>
      )}
      <ActionBar disabled={saving} onSave={() => save(false)} onRequest={() => save(true)} />
    </form>
  );
}

/** HIG のナビゲーションバー: 左にキャンセル、中央に題名 */
function NavigationBar({ title, onCancel }: { title: string; onCancel: () => void }) {
  return (
    <header className="-mx-4 mb-2 grid grid-cols-[1fr_auto_1fr] items-center px-2">
      <button type="button" onClick={onCancel} className="min-h-11 justify-self-start px-2 text-[17px] text-tint active:opacity-60">キャンセル</button>
      <h1 className="text-[17px] font-semibold">{title}</h1>
      <span />
    </header>
  );
}

/** 画面下に固定する操作（親指の届く位置）。タブバーは作成中は隠す */
function ActionBar({ disabled, onSave, onRequest }: { disabled: boolean; onSave: () => void; onRequest: () => void }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-10 border-t border-separator bg-bar pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
      <div className="mx-auto grid max-w-xl grid-cols-[auto_1fr] gap-2 px-4 py-2">
        <Button variant="plain" disabled={disabled} onClick={onSave}>下書き保存</Button>
        <Button variant="filled" disabled={disabled} onClick={onRequest}>承認を依頼</Button>
      </div>
    </div>
  );
}
