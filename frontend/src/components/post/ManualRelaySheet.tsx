"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { GroupedSection } from "@/components/ui/Grouped";
import { DraftApiError, importManual, manualPrompt, type DraftResponse } from "@/lib/api/draftApi";

/** 修正指示のとき（親の生成・指示・今の内容）。新規のときは渡さない */
export type ManualRevision = { parentGenerationId: string; instruction: string; current: unknown };

/**
 * S-07b 手動コピペ: ①プロンプト（コピー）②外部のAIが返した JSON を貼り付け ③「取り込む」。
 * 上限・障害のときに続けるための入口。違反は行ごとに出す（AC-002-07）。ネタは ideaId があれば同じものを使う
 */
export function ManualRelaySheet({ ideaId, ideaText, revision, onImported, onClose }: {
  ideaId: string | null; ideaText: string; revision?: ManualRevision;
  onImported: (response: DraftResponse) => void; onClose: () => void;
}) {
  const [prompt, setPrompt] = useState<{ ideaId: string; promptVersionId: string; text: string } | null>(null);
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState<string | null>("プロンプトを用意しています…");
  const [error, setError] = useState<{ message: string; lines: string[] } | null>(null);
  const [copied, setCopied] = useState(false);
  const requested = useRef(false);

  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    manualPrompt({ ...(ideaId ? { ideaId } : { ideaText }), ...(revision ? { instruction: revision.instruction, current: revision.current } : {}) })
      .then((r) => setPrompt({ ideaId: r.ideaId, promptVersionId: r.promptVersionId, text: r.prompt }),
        (e: Error) => setError(describe(e)))
      .finally(() => setBusy(null));
  }, [ideaId, ideaText, revision]);

  const copy = async () => {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt.text);
      setCopied(true);
    } catch {
      setError({ message: "コピーできませんでした。プロンプトを長押しして選んでコピーしてください", lines: [] });
    }
  };

  const importJson = async () => {
    if (!prompt) return;
    setBusy("取り込んでいます…");
    setError(null);
    try {
      onImported(await importManual({ ideaId: prompt.ideaId, promptVersionId: prompt.promptVersionId, json: pasted, revision }));
    } catch (e) {
      setError(describe(e as Error));
      setBusy(null);
    }
  };

  return (
    <div role="dialog" aria-label="手動コピペで続ける" className="fixed inset-0 z-20 overflow-y-auto bg-grouped px-4 pb-28 pt-[max(0.5rem,env(safe-area-inset-top))]">
      <header className="-mx-4 mb-2 grid grid-cols-[1fr_auto_1fr] items-center px-2">
        <button type="button" onClick={onClose} className="min-h-11 justify-self-start px-2 text-[17px] text-tint active:opacity-60">キャンセル</button>
        <h1 className="text-[17px] font-semibold">手動コピペで続ける</h1>
        <span />
      </header>
      <GroupedSection title="① プロンプトをコピーして、外部のAIに貼る" footer="外部のAIには、団体の個人情報や入稿者の連絡先を貼らないでください">
        <textarea aria-label="プロンプト" readOnly rows={6} value={prompt?.text ?? ""} className="block w-full resize-y bg-transparent px-4 py-3 text-[15px] outline-none" />
        <div className="border-t border-separator p-2">
          <Button variant="tinted" block disabled={!prompt} onClick={copy}>{copied ? "コピーしました" : "プロンプトをコピー"}</Button>
        </div>
      </GroupedSection>
      <GroupedSection title="② 返ってきた JSON を貼る" footer="前後の ```json は付いたままで大丈夫です">
        <textarea aria-label="貼り付ける JSON" rows={8} value={pasted} onChange={(e) => setPasted(e.target.value)}
          className="block w-full resize-y bg-transparent px-4 py-3 font-mono text-[14px] outline-none" />
      </GroupedSection>
      {error && (
        <div role="alert" className="mt-3 px-4 text-[15px] text-destructive">
          <p>{error.message}</p>
          {error.lines.length > 0 && <ul className="list-disc pl-5 pt-1 text-[14px]">{error.lines.map((l) => <li key={l}>{l}</li>)}</ul>}
        </div>
      )}
      {busy && <p role="status" className="mt-3 px-4 text-center text-[15px] text-secondary-label">{busy}</p>}
      <div className="fixed inset-x-0 bottom-0 border-t border-separator bg-bar pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
        <div className="mx-auto max-w-xl px-4 py-2">
          <Button variant="filled" block disabled={busy !== null || !prompt || pasted.trim() === ""} onClick={importJson}>取り込む</Button>
        </div>
      </div>
    </div>
  );
}

const describe = (e: Error) => ({ message: e.message, lines: e instanceof DraftApiError ? e.details : [] });
