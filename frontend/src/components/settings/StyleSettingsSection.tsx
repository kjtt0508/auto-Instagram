"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/components/session/SessionGate";
import { Button } from "@/components/ui/Button";
import { Cell, GroupedSection } from "@/components/ui/Grouped";
import { PostStyleSettings } from "@/domain/post/PostStyleSettings";
import { saveStyleSettings } from "@/lib/api/generationAdministration";
import { uploadStyleLogo, viewUrls } from "@/lib/api/mediaStorage";
import { currentStyleSettings } from "@/lib/api/styleRepository";
import { convertLogo } from "@/lib/image/imageConversion";
import { FORM_INPUT, FormField } from "./AdminPage";

const TARGET_SEPARATOR = /[、,，\n]/u;
const HASHTAG_SEPARATOR = /\s+/u;

/** 画面の入力欄（文字列のまま持つ。保存するときに分けて、ドメインで検査する） */
type Form = {
  bandText: string; coverTargets: string; closingMessage: string; accountIntroduction: string; captionFooter: string;
  fixedHashtags: string; logoStoragePath: string | undefined;
};

const EMPTY: Form = { bandText: "", coverTargets: "", closingMessage: "", accountIntroduction: "", captionFooter: "", fixedHashtags: "", logoStoragePath: undefined };

const toForm = (s: PostStyleSettings): Form => ({
  bandText: s.bandText, coverTargets: s.coverTargets().join("、"), closingMessage: s.closingMessage, accountIntroduction: s.accountIntroduction,
  captionFooter: s.captionFooter().text, fixedHashtags: s.fixedHashtags().texts().join(" "), logoStoragePath: s.logoStoragePath,
});

const words = (text: string, separator: RegExp) => text.split(separator).map((w) => w.trim()).filter((w) => w !== "");

/** S-15 投稿の型の設定: 固定の文言・候補・ロゴを直し、保存で新しい版にする（承認済みの投稿は使った版のまま。BR-002-17） */
export function StyleSettingsSection() {
  const [state, setState] = useState<{ settings: PostStyleSettings | null; savedVersion: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    currentStyleSettings().then((settings) => setState({ settings, savedVersion: null }), (e: Error) => setError(e.message));
  }, []);

  if (error) return <p role="alert" className="px-4 py-10 text-center text-destructive">{error}</p>;
  if (!state) return <p className="px-4 py-10 text-center text-secondary-label">読み込み中…</p>;
  // 保存すると版が変わるので、フォームを作り直して、保存した内容（ロゴの保存先を含む）から始める
  return <StyleForm key={state.settings?.version ?? 0} current={state.settings} justSaved={state.savedVersion}
    onSaved={(settings, savedVersion) => setState({ settings, savedVersion })} />;
}

function StyleForm({ current, justSaved, onSaved }: {
  current: PostStyleSettings | null; justSaved: number | null; onSaved: (settings: PostStyleSettings | null, savedVersion: number) => void;
}) {
  const { tenant } = useSession();
  const [form, setForm] = useState<Form>(current ? toForm(current) : EMPTY);
  const [newLogo, setNewLogo] = useState<{ blob: Blob; url: string } | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | undefined>(undefined);
  const [showIssues, setShowIssues] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(justSaved);
  const edit = (patch: Partial<Form>) => { setForm({ ...form, ...patch }); setSaved(null); };

  useEffect(() => {
    if (!form.logoStoragePath) return;
    viewUrls([form.logoStoragePath]).then((urls) => setLogoUrl(urls.get(form.logoStoragePath!)), () => setLogoUrl(undefined));
  }, [form.logoStoragePath]);
  useEffect(() => () => { if (newLogo) URL.revokeObjectURL(newLogo.url); }, [newLogo]);

  const targets = words(form.coverTargets, TARGET_SEPARATOR);
  const hashtags = words(form.fixedHashtags, HASHTAG_SEPARATOR);
  const issues = PostStyleSettings.violationsOfInput({ coverTargets: targets, captionFooter: form.captionFooter, fixedHashtags: hashtags });
  const shown = (violations: string[]) => (showIssues ? violations : []);
  const hasIssues = Object.values(issues).some((v) => v.length > 0);

  const chooseLogo = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const blob = await convertLogo(file);
      setNewLogo({ blob, url: URL.createObjectURL(blob) });
      setSaved(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const save = async () => {
    setShowIssues(true);
    if (hasIssues) return;
    setBusy(true);
    setError(null);
    try {
      const logoStoragePath = newLogo ? await uploadStyleLogo(tenant, newLogo.blob) : form.logoStoragePath;
      const version = await saveStyleSettings({ ...form, coverTargets: targets, fixedHashtags: hashtags, logoStoragePath });
      onSaved(await currentStyleSettings(), version);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const logoShown = newLogo?.url ?? (form.logoStoragePath ? logoUrl : undefined);
  const hasLogo = newLogo !== null || form.logoStoragePath !== undefined;
  return (
    <>
      <GroupedSection title="表紙・最後のスライド" label="表紙・最後のスライド"
        footer="上端の帯の文言は表紙の上端に出ます。最後のスライドには、定型文・過去の投稿2件・アカウントの紹介が並びます">
        <FormField label="上端の帯の文言">
          <input aria-label="上端の帯の文言" value={form.bandText} onChange={(e) => edit({ bandText: e.target.value })} className={FORM_INPUT} />
        </FormField>
        <FormField label="表紙の対象の候補" violations={shown(issues.coverTargets)} hint="「、」で区切ります（例: 同志社大学、同志社大生）">
          <input aria-label="表紙の対象の候補" value={form.coverTargets} onChange={(e) => edit({ coverTargets: e.target.value })} className={FORM_INPUT} />
        </FormField>
        <FormField label="最後のスライドの定型文">
          <textarea aria-label="最後のスライドの定型文" rows={2} value={form.closingMessage} onChange={(e) => edit({ closingMessage: e.target.value })} className={FORM_INPUT} />
        </FormField>
        <FormField label="アカウントの紹介">
          <textarea aria-label="アカウントの紹介" rows={3} value={form.accountIntroduction} onChange={(e) => edit({ accountIntroduction: e.target.value })} className={FORM_INPUT} />
        </FormField>
      </GroupedSection>

      <GroupedSection title="キャプション" label="キャプション" footer="本文の後ろに毎回付きます。AI は書き換えません">
        <FormField label="キャプションの定型" violations={shown(issues.captionFooter)}>
          <textarea aria-label="キャプションの定型" rows={5} value={form.captionFooter} onChange={(e) => edit({ captionFooter: e.target.value })} className={FORM_INPUT} />
        </FormField>
        <FormField label="固定ハッシュタグ" violations={shown(issues.fixedHashtags)} hint="空白で区切ります（例: #同志社大学 #同志社）">
          <input aria-label="固定ハッシュタグ" value={form.fixedHashtags} onChange={(e) => edit({ fixedHashtags: e.target.value })} className={FORM_INPUT} />
        </FormField>
      </GroupedSection>

      <GroupedSection title="ロゴ" label="ロゴ" footer="PNG にして保存します（長いほうの辺を1024px まで縮小）。無くてもかまいません">
        {logoShown && (
          <Cell>
            {/* eslint-disable-next-line @next/next/no-img-element -- ロゴのプレビュー（期限付き URL・blob URL） */}
            <img src={logoShown} alt="ロゴ" className="mx-auto max-h-24 max-w-full object-contain" />
          </Cell>
        )}
        <label className="flex min-h-11 cursor-pointer items-center justify-center px-4 py-2.5 text-[17px] text-tint active:bg-fill">
          {hasLogo ? "ロゴを選び直す" : "ロゴを選ぶ"}
          <input type="file" accept="image/png,image/jpeg" aria-label="ロゴを選ぶ" className="sr-only"
            onChange={(e) => { void chooseLogo(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        {hasLogo && (
          <div className="border-t border-separator">
            <Button variant="destructive" block disabled={busy} onClick={() => { setNewLogo(null); edit({ logoStoragePath: undefined }); setLogoUrl(undefined); }}>ロゴを外す</Button>
          </div>
        )}
      </GroupedSection>

      <div className="mt-6">
        {error && <p role="alert" className="px-4 pb-2 text-[13px] text-destructive">{error}</p>}
        {saved !== null && (
          <p role="status" className="px-4 pb-2 text-[15px] text-success">版{saved}として保存しました。承認済みの投稿は、承認したときの版のままです</p>
        )}
        <Button variant="filled" block disabled={busy} onClick={save}>{busy ? "保存しています…" : "新しい版として保存"}</Button>
        <p className="px-4 pt-1.5 text-[13px] text-secondary-label">
          {current ? `いまの版: 版${current.version}。保存すると版${current.version + 1}になります` : "まだ設定されていません。保存すると版1になります"}
        </p>
      </div>
    </>
  );
}
