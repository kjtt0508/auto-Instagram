"use client";

import { useState } from "react";
import { fromJapanLocalInput, toJapanLocalInput } from "@/components/format";
import { Button } from "@/components/ui/Button";
import { GroupedSection } from "@/components/ui/Grouped";
import type { Post } from "@/domain/post/Post";
import { ScheduledAt } from "@/domain/post/ScheduledAt";
import { approve } from "@/lib/api/postCommands";

const DEFAULT_AHEAD_MS = 24 * 60 * 60 * 1000;

/** 日時を選んで承認する（承認者・管理者。AC-001-10, 11）。確定時点で未来かつ1年以内 */
export function ApproveForm({ post, onDone }: { post: Post; onDone: () => void }) {
  const [localValue, setLocalValue] = useState(() => toJapanLocalInput(new Date(Date.now() + DEFAULT_AHEAD_MS)).slice(0, 11) + "18:00");
  const [error, setError] = useState<string | null>(null);

  // 予約日時の検査は ScheduledAt.decide に任せ、確定できなければその理由を出す（RetryForm と同じ）
  const submit = async () => {
    setError(null);
    try {
      await approve(post.id, post.content.revisionId, ScheduledAt.decide(fromJapanLocalInput(localValue), new Date()));
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <GroupedSection title="承認して予約" footer="定期処理は15分ごとのため、公開は指定の時刻から最大15分ほど遅れます">
      <label className="flex min-h-11 items-center justify-between gap-3 px-4 py-1.5" htmlFor="scheduled-at">
        <span>公開日時</span>
        <input id="scheduled-at" type="datetime-local" value={localValue} onChange={(e) => setLocalValue(e.target.value)}
          className="min-h-9 min-w-0 rounded-[8px] bg-fill px-2 text-[15px]" />
      </label>
      <div className="border-t border-separator p-3">
        <Button variant="filled" block onClick={submit}>承認して予約</Button>
        {error && <p role="alert" className="whitespace-pre-line pt-2 text-[13px] text-destructive">{error}</p>}
      </div>
    </GroupedSection>
  );
}
