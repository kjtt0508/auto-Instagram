"use client";

import { useState } from "react";
import { fromJapanLocalInput } from "@/components/format";
import { Button } from "@/components/ui/Button";
import { ScheduledAt } from "@/domain/post/ScheduledAt";
import { retry } from "@/lib/api/postCommands";

/** 失敗した投稿の再実行（AC-001-18）。「今すぐ」か、新しい日時を決めて予約中に戻す */
export function RetryForm({ postId, onDone }: { postId: string; onDone: () => void }) {
  const [localValue, setLocalValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async (decide: () => ScheduledAt) => {
    setError(null);
    try {
      await retry(postId, decide());
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-2">
      <Button variant="filled" block onClick={() => submit(() => ScheduledAt.immediate(new Date()))}>今すぐ再実行</Button>
      <div className="flex items-center gap-2">
        <input type="datetime-local" aria-label="再実行の日時" value={localValue} onChange={(e) => setLocalValue(e.target.value)}
          className="min-h-11 min-w-0 flex-1 rounded-[8px] bg-fill px-3 text-[15px]" />
        <Button variant="tinted" className="shrink-0 text-[15px]"
          onClick={() => submit(() => ScheduledAt.decide(fromJapanLocalInput(localValue), new Date()))}>日時を指定</Button>
      </div>
      {error && <p role="alert" className="text-[13px] text-destructive">{error}</p>}
    </div>
  );
}
