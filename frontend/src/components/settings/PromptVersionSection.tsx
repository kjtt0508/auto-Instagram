"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Cell, GroupedSection } from "@/components/ui/Grouped";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { PromptPurpose } from "@/domain/draft/PromptPurpose";
import type { PromptVersion } from "@/domain/draft/PromptVersion";
import {
  activatePromptVersion, createPromptVersion, promptVersionsOf, type PromptVersions,
} from "@/lib/api/generationAdministration";
import { FORM_INPUT, FormField } from "./AdminPage";

/** 画面で扱う用途（キャプション生成は REQ-003 で扱う） */
const PURPOSES = [PromptPurpose.PLAN, PromptPurpose.REVISE];

/** S-10 プロンプト版: 用途ごとの版の一覧（有効な版に印）→ 本文 →「新しい版として保存」（作って有効にする）。BR-002-07 */
export function PromptVersionSection() {
  const [purpose, setPurpose] = useState(PromptPurpose.PLAN);
  return (
    <>
      <GroupedSection label="用途">
        <div className="p-2"><SegmentedControl label="用途" options={PURPOSES} selected={purpose} onSelect={setPurpose} /></div>
      </GroupedSection>
      <PurposeVersions key={purpose.code} purpose={purpose} />
    </>
  );
}

function PurposeVersions({ purpose }: { purpose: PromptPurpose }) {
  const [data, setData] = useState<PromptVersions | null>(null);
  const [body, setBody] = useState("");
  const [viewingId, setViewingId] = useState<string | undefined>(undefined);
  const [showIssues, setShowIssues] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** 作ったが有効にできなかった版（もう一度「有効にする」を出す） */
  const [unactivated, setUnactivated] = useState<PromptVersion | null>(null);

  const load = () => promptVersionsOf(purpose).then((loaded) => { setData(loaded); return loaded; });
  useEffect(() => {
    promptVersionsOf(purpose).then((loaded) => {
      const shown = loaded.versions.find((v) => v.id === loaded.activeId) ?? loaded.versions[0];
      setData(loaded);
      setViewingId(shown?.id);
      setBody(shown?.bodyText() ?? "");
    }, (e: Error) => setError(e.message));
  }, [purpose]);

  const view = (version: PromptVersion) => { setViewingId(version.id); setBody(version.bodyText()); setShowIssues(false); setNotice(null); };
  const issues = purpose.violationsOfBody(body);

  /** 有効にする。できなかったら、作った版は無効のまま残るので「有効にする」をもう一度出す */
  const activate = async (version: PromptVersion) => {
    setError(null);
    try {
      await activatePromptVersion(version.id);
      setUnactivated(null);
      setNotice(`版${version.versionNo}を有効にしました。以後の生成はこの版を記録します`);
      await load();
    } catch (e) {
      setUnactivated(version);
      setError(`版${version.versionNo}を有効にできませんでした: ${(e as Error).message}`);
    }
  };

  const save = async () => {
    setShowIssues(true);
    if (issues.length > 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    let createdId: string;
    try {
      createdId = await createPromptVersion(purpose, body);
    } catch (e) {
      setError(`保存できませんでした: ${(e as Error).message}`);
      setBusy(false);
      return;
    }
    try {
      const created = (await load()).versions.find((v) => v.id === createdId);
      if (!created) throw new Error("作った版を読み込めませんでした。画面を更新してください");
      setViewingId(created.id);
      await activate(created);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!data) return error ? <p role="alert" className="px-4 py-10 text-center text-destructive">{error}</p>
    : <p className="px-4 py-10 text-center text-secondary-label">読み込み中…</p>;
  const names = purpose.placeholderNames() ?? [];
  return (
    <>
      <GroupedSection title={`${purpose.label}の版`} label="版の一覧">
        {data.versions.length === 0 && <Cell><span className="text-secondary-label">まだ版がありません</span></Cell>}
        {data.versions.map((v) => (
          <Cell key={v.id}>
            <div data-version-no={v.versionNo} data-active={v.id === data.activeId} className="flex min-h-9 items-center justify-between gap-3">
              <button type="button" aria-pressed={v.id === viewingId} onClick={() => view(v)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left aria-pressed:font-semibold">
                <span>版{v.versionNo}</span>
                {v.id === data.activeId && <span className="rounded-full bg-success px-2 text-[13px] font-semibold text-on-tint">有効</span>}
              </button>
              {v.id !== data.activeId && (
                <Button variant="tinted" disabled={busy} onClick={() => activate(v)} className="!min-h-9 !py-1">有効にする</Button>
              )}
            </div>
          </Cell>
        ))}
      </GroupedSection>

      <GroupedSection title="本文" label="本文"
        footer={`差し込み値を全部入れてください: ${names.map((n) => `{{${n}}}`).join(" ")}。本文を変えるときは新しい版として保存します（いまの版は変わりません）`}>
        <FormField label={viewingId ? `版${data.versions.find((v) => v.id === viewingId)?.versionNo ?? ""}をもとに編集` : "新しい版の本文"}
          count={`${[...body].length}文字`} violations={showIssues ? issues : []}>
          <textarea aria-label="本文" rows={14} value={body} onChange={(e) => { setBody(e.target.value); setNotice(null); }}
            className={`${FORM_INPUT} font-mono text-[15px] leading-snug`} />
        </FormField>
      </GroupedSection>

      <div className="mt-6">
        {error && <p role="alert" className="px-4 pb-2 text-[13px] text-destructive">{error}</p>}
        {notice && <p role="status" className="px-4 pb-2 text-[15px] text-success">{notice}</p>}
        {unactivated && (
          <div className="pb-2">
            <Button variant="tinted" block disabled={busy} onClick={() => activate(unactivated)}>版{unactivated.versionNo}を有効にする</Button>
          </div>
        )}
        <Button variant="filled" block disabled={busy} onClick={save}>{busy ? "保存しています…" : "新しい版として保存"}</Button>
      </div>
    </>
  );
}
