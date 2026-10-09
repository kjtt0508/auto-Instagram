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
import { hasTemplateWork } from "@/lib/api/templateDraftAutosave";
import { CaptionField } from "./CaptionField";
import { MediaPicker } from "./MediaPicker";
import { NavigationBar } from "./NavigationBar";
import { TemplatePostEditor } from "./TemplatePostEditor";

// S-03 の作り方の2択
const PHOTOS = { code: "PHOTOS", label: "写真で作る" };
const AI = { code: "AI", label: "AIで作る" };
const SOURCES = [PHOTOS, AI];
type PostSource = typeof PHOTOS;

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
  // 新規は冒頭で「写真で作る」「AIで作る」を選ぶ。作成中のAI下書きが端末に残っていればそちらから始める
  const [source, setSource] = useState<PostSource>(() => (postId === null && hasTemplateWork() ? AI : PHOTOS));
  const chooser = postId === null && (
    <GroupedSection title="作り方" label="作り方">
      <div className="p-2"><SegmentedControl label="作り方" options={SOURCES} selected={source} onSelect={setSource} /></div>
    </GroupedSection>
  );
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

  if (postId === null && source === AI) return <TemplatePostEditor postId={null} title={title} chooser={chooser} />;

  return (
    <form onSubmit={(e) => e.preventDefault()} className="pb-24">
      <NavigationBar title={title} onCancel={() => router.back()} />
      {chooser}
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
