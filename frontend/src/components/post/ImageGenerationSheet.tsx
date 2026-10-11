"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { GroupedSection } from "@/components/ui/Grouped";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ImageCandidate } from "@/domain/image/ImageCandidate";
import type { ImageGenerationUsage } from "@/domain/image/ImageGenerationUsage";
import { ImagePrompt } from "@/domain/image/ImagePrompt";
import { ImageStyle } from "@/domain/post/ImageStyle";
import { clearCandidates, generateCandidates, imageGenerationUsage } from "@/lib/api/imageGenerationApi";
import { explainFailure, type ImageGenerationPurpose } from "./ImageGenerationPurpose";

/** 選んだ候補。`image` は用途が画像のバイト列を要るとき（needsImageBytes）だけ入る（要らない用途はサーバーが候補を複製する） */
export type ChosenCandidate = { candidate: ImageCandidate; image: Blob | null };

/** 選んだ候補の画像（画像のバイト列を要る用途が受け取る） */
export function imageOf(chosen: ChosenCandidate): Blob {
  if (!chosen.image) throw new Error("候補の画像を取得していません");
  return chosen.image;
}

/** 候補の画像（期限付き URL は1時間。切れていたら作り直してもらう） */
async function candidateImage(url: string): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("候補の期限が切れました。作り直してください");
  return response.blob();
}

/**
 * S-13 画像を生成する（REQ-005 設計 3章）: ①画像の種類 ②指示 ③今日の残り回数 ④生成 ⑤候補（2×2、複数選べる）⑥選んだ画像を使う。
 * 用途（投稿画像・素材画像・表紙の背景）ごとの違いは `purpose`（ImageGenerationPurpose の表）が持つ。
 * 閉じるときは候補を片付ける（失敗しても daily が消す）
 */
export function ImageGenerationSheet({ purpose, slots = 1, initialPrompt = "", onChoose, onClose }: {
  purpose: ImageGenerationPurpose;
  /** 空けられる枚数（投稿画像の残り枠）。選べる枚数は用途が決める */
  slots?: number;
  /** 選んだ候補を使う。説明文の欄がある用途では、人が確かめた説明文も渡る（無ければ null）。失敗（例外）なら候補は片付けず、理由を出してやり直せる */
  onChoose: (chosen: ChosenCandidate[], description: string | null) => Promise<void>;
  onClose: () => void;
  /** 指示の初期値（中のスライドの絵の指示など） */
  initialPrompt?: string;
}) {
  const maxChoices = purpose.maxChoices(slots);
  const [style, setStyle] = useState<ImageStyle>(purpose.styles[0]);
  const [promptText, setPromptText] = useState(initialPrompt);
  const [usage, setUsage] = useState<ImageGenerationUsage | null>(null);
  // 候補は生成した時の画像の種類を持つ（生成後にセグメントを切り替えても、採用する候補の種類は変わらない）
  const [result, setResult] = useState<{ generationId: string; style: ImageStyle; candidates: { position: number; url: string }[] } | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    imageGenerationUsage().then(setUsage, () => setUsage(null));
  }, []);
  const toggle = (position: number) => {
    if (selected.includes(position)) return setSelected(selected.filter((p) => p !== position));
    if (maxChoices === 1) return setSelected([position]);   // 1枚だけ選ぶときは、ほかの候補に触れると選び直しになる
    if (selected.length < maxChoices) setSelected([...selected, position]); // 選べる枚数を超えては選べない
  };
  const descriptionIssues = purpose.description && result ? purpose.description.violationsOf(description) : [];

  const generate = async () => {
    const violations = ImagePrompt.violationsOf(promptText);
    if (violations.length > 0) return setError(violations[0]);
    setBusy("生成しています…（30秒ほどかかります）");
    setError(null);
    try {
      if (result) await clearCandidates(result.generationId);
      const generated = await generateCandidates(style, ImagePrompt.of(promptText));
      setResult({ ...generated, style });
      setUsage(generated.usage);
      setSelected([]);
      setDescription(purpose.description?.initialValue(promptText) ?? "");
    } catch (e) {
      setError(explainFailure(purpose, e));
    } finally {
      setBusy(null);
    }
  };

  const choose = async () => {
    if (!result) return;
    setBusy(purpose.choosingMessage);
    setError(null);
    try {
      const chosen = await Promise.all(selected.map(async (position) => ({
        candidate: ImageCandidate.of({ generationId: result.generationId, position, style: result.style }),
        image: purpose.needsImageBytes ? await candidateImage(result.candidates.find((c) => c.position === position)!.url) : null,
      })));
      await onChoose(chosen, purpose.description ? description.trim() : null);
      await clearCandidates(result.generationId);
      onClose();
    } catch (e) {
      setError(explainFailure(purpose, e));
      setBusy(null);
    }
  };

  const close = () => {
    if (result) void clearCandidates(result.generationId);
    onClose();
  };

  return (
    <div role="dialog" aria-label="画像を生成する" className="fixed inset-0 z-20 overflow-y-auto bg-grouped px-4 pb-28 pt-[max(0.5rem,env(safe-area-inset-top))]">
      <header className="-mx-4 mb-2 grid grid-cols-[1fr_auto_1fr] items-center px-2">
        <button type="button" onClick={close} className="min-h-11 justify-self-start px-2 text-[17px] text-tint active:opacity-60">キャンセル</button>
        <h1 className="text-[17px] font-semibold">{purpose.title}</h1>
        <span />
      </header>
      <GroupedSection title="画像の種類" footer={style.showsCaution()
        ? "イメージ写真としてだけ使えます。実際の出来事・場所・人を撮ったように見せる使い方や、実在の人物・商標を求める指示はできません"
        : "背景や挿絵に使える画像を作ります。画像に文字は入れません"}>
        <div className="p-2">
          {purpose.styles.length > 1
            ? <SegmentedControl label="画像の種類" options={purpose.styles} selected={style} onSelect={setStyle} />
            // 選べる種類が1つの用途は、選べない固定の表示にする
            : <p data-fixed-style className="flex min-h-11 items-center px-2 text-[17px]">{style.label}</p>}
        </div>
      </GroupedSection>
      <PromptField value={promptText} onChange={setPromptText} usage={usage} limitNotice={purpose.usageLimitNotice} placeholder={purpose.promptPlaceholder} />
      {error && <p role="alert" className="mt-3 px-4 text-[15px] text-destructive">{error}</p>}
      {busy && <p role="status" className="mt-3 px-4 text-center text-[15px] text-secondary-label">{busy}</p>}
      {result && !busy && <CandidateGrid candidates={result.candidates} selected={selected} maxChoices={maxChoices} onToggle={toggle} />}
      {purpose.description && result && !busy && (
        <DescriptionField label={purpose.description.label} value={description} violations={descriptionIssues} onChange={setDescription} />
      )}
      <div className="fixed inset-x-0 bottom-0 border-t border-separator bg-bar pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
        <div className="mx-auto grid max-w-xl grid-cols-2 gap-2 px-4 py-2">
          <Button variant="tinted" disabled={busy !== null || (usage !== null && !usage.canGenerate())} onClick={generate}>
            {result ? "作り直す" : "生成"}
          </Button>
          <Button variant="filled" disabled={busy !== null || selected.length === 0 || descriptionIssues.length > 0} onClick={choose}>
            {purpose.confirmLabel(selected.length)}
          </Button>
        </div>
      </div>
    </div>
  );
}

function PromptField({ value, onChange, usage, limitNotice, placeholder }: {
  value: string; onChange: (v: string) => void; usage: ImageGenerationUsage | null; limitNotice: string; placeholder: string;
}) {
  const footer = usage === null ? "" : !usage.canGenerate()
    ? <span className="text-destructive">{limitNotice}</span>
    : <span className={usage.isNearLimit() ? "text-destructive" : undefined}>今日あと {usage.remaining()} 回作れます（1回で4枚）</span>;
  return (
    <GroupedSection title={`作りたい画像（${[...value].length} / ${ImagePrompt.MAX_LENGTH}文字）`} label="作りたい画像" footer={footer}>
      <textarea aria-label="作りたい画像" rows={4} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} className="block w-full resize-y bg-transparent px-4 py-3 text-[17px] outline-none" />
    </GroupedSection>
  );
}

/** 説明文（背景写真の説明文など。1行）。満たさない条件は欄の下に赤字で出す */
function DescriptionField({ label, value, violations, onChange }: {
  label: string; value: string; violations: readonly string[]; onChange: (value: string) => void;
}) {
  return (
    <GroupedSection title={label} label={label}
      footer={<>
        <span className="block">AI が話題に合う背景を選ぶ手がかりになります。直せます</span>
        {violations.map((v) => <span key={v} data-violation={label} className="block text-destructive">{v}</span>)}
      </>}>
      <input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="block w-full bg-transparent px-4 py-3 text-[17px] outline-none" />
    </GroupedSection>
  );
}

function CandidateGrid({ candidates, selected, maxChoices, onToggle }: {
  candidates: { position: number; url: string }[]; selected: number[]; maxChoices: number; onToggle: (position: number) => void;
}) {
  return (
    <GroupedSection title={`候補（タップで選ぶ・${maxChoices}枚まで）`} label="候補">
      <ul className="grid grid-cols-2 gap-2 p-2">
        {candidates.map((c) => (
          <li key={c.position}>
            <button type="button" aria-pressed={selected.includes(c.position)} aria-label={`候補${c.position}`} onClick={() => onToggle(c.position)}
              className="relative block w-full overflow-hidden rounded-[8px] ring-tint aria-pressed:ring-4">
              {/* eslint-disable-next-line @next/next/no-img-element -- 期限付き URL の画像（最適化しない） */}
              <img src={c.url} alt={`候補${c.position}`} className="aspect-square w-full object-cover" />
              {selected.includes(c.position) && (
                <span className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-tint text-[15px] font-bold text-on-tint">
                  {selected.indexOf(c.position) + 1}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </GroupedSection>
  );
}
