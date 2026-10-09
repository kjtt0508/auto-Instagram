"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Cell, GroupedSection } from "@/components/ui/Grouped";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type { PostStyleSettings } from "@/domain/post/PostStyleSettings";
import { AccentColor } from "@/domain/slide/AccentColor";
import type { BodyContent } from "@/domain/slide/BodyContent";
import type { CoverContent } from "@/domain/slide/CoverContent";
import { CoverText } from "@/domain/slide/CoverText";
import { PictureBrief } from "@/domain/slide/PictureBrief";
import { SlideText } from "@/domain/slide/SlideText";
import { viewUrls } from "@/lib/api/mediaStorage";
import type { BackgroundPhoto } from "@/lib/api/styleRepository";

const INPUT = "block w-full rounded-[8px] bg-fill px-3 py-2 text-[17px] outline-none";

/** ネタに無い情報（日付・金額・URL）の黄色の印。該当の語を示す */
export type Fact = { location: string; fact: string };

/** 欄1つ: ラベルと文字数、入力、欄ごとの赤字の理由、ネタに無い情報の黄色の印 */
function Field({ label, count, violations, facts = [], children }: {
  label: string; count?: string; violations: readonly string[]; facts?: readonly string[]; children: ReactNode;
}) {
  return (
    <Cell>
      <div className="flex items-baseline justify-between gap-2 pb-1 text-[13px] text-secondary-label">
        <span>{label}</span>{count && <span>{count}</span>}
      </div>
      {children}
      {violations.map((v) => <p key={v} data-violation={label} className="pt-1 text-[13px] text-destructive">{v}</p>)}
      {facts.length > 0 && (
        <p className="pt-1 text-[13px] text-secondary-label">
          ネタに無い情報かもしれません: {facts.map((f) => <mark key={f} data-mark="unsupported" className="mx-0.5 rounded bg-caution px-1 text-black">{f}</mark>)}
        </p>
      )}
    </Cell>
  );
}

const lengthOf = (text: string) => [...text].length;

/** 語を「、」で区切って入力する欄（打ちかけの「、」を消さないよう、入力中の文字は欄が持つ） */
export function WordsInput({ label, initial, separator, joiner, onChange }: {
  label: string; initial: readonly string[]; separator: RegExp; joiner: string; onChange: (words: string[]) => void;
}) {
  const [text, setText] = useState(initial.join(joiner));
  return (
    <input aria-label={label} value={text} className={INPUT}
      onChange={(e) => { setText(e.target.value); onChange(e.target.value.split(separator).map((w) => w.trim()).filter((w) => w !== "")); }} />
  );
}

export const WORD_SEPARATOR = /[、,，]/u;
export const HASHTAG_SEPARATOR = /\s+/u;

/** S-07 ④ 表紙の編集: 対象・キーワード・添え書き・締めの言葉・帯の色・背景写真 */
export function CoverFields({ cover, settings, photos, facts, onChange }: {
  cover: CoverContent; settings: PostStyleSettings; photos: readonly BackgroundPhoto[]; facts: readonly Fact[];
  onChange: (cover: CoverContent) => void;
}) {
  const [choosing, setChoosing] = useState(false);
  const text = cover.text;
  const issues = text.violationsByField(settings);
  const edit = (patch: Partial<{ target: string; keyword: string; annotation: string; closingWords: string; accentCode: string }>) =>
    onChange(cover.withText(CoverText.restore({ ...text, accentCode: text.accent.code, ...patch })));
  const factsAt = (location: string) => facts.filter((f) => f.location === location).map((f) => f.fact);
  const targets = settings.coverTargets().includes(text.target) ? settings.coverTargets() : [text.target, ...settings.coverTargets()];
  const current = photos.find((p) => p.id === cover.background?.photoId);

  return (
    <GroupedSection title="表紙の編集" label="表紙の編集">
      <Field label="対象" violations={issues.target}>
        <select aria-label="対象" value={text.target} onChange={(e) => edit({ target: e.target.value })} className={INPUT}>
          {targets.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </Field>
      <Field label="キーワード" count={`${lengthOf(text.keyword)} / ${CoverText.KEYWORD_MAX}`} violations={issues.keyword} facts={factsAt("cover.keyword")}>
        <input aria-label="キーワード" value={text.keyword} onChange={(e) => edit({ keyword: e.target.value })} className={INPUT} />
      </Field>
      <Field label="添え書き" count={`${lengthOf(text.annotation)} / ${CoverText.ANNOTATION_MAX}`} violations={issues.annotation} facts={factsAt("cover.annotation")}>
        <input aria-label="添え書き" value={text.annotation} onChange={(e) => edit({ annotation: e.target.value })} className={INPUT} />
      </Field>
      <Field label="締めの言葉" count={`${lengthOf(text.closingWords)} / ${CoverText.CLOSING_WORDS_MAX}`} violations={issues.closingWords}>
        <input aria-label="締めの言葉" value={text.closingWords} onChange={(e) => edit({ closingWords: e.target.value })} className={INPUT} />
      </Field>
      <Field label="帯の色" violations={issues.accent}>
        <SegmentedControl label="帯の色" options={AccentColor.all()} selected={text.accent} onSelect={(accent) => edit({ accentCode: accent.code })} />
      </Field>
      <Field label="背景写真" violations={[]}>
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0 truncate text-[15px]">{cover.background ? (current?.description ?? "選んだ写真") : "なし（紺の単色）"}</span>
          <Button variant="tinted" onClick={() => setChoosing(true)}>背景写真を選び直す</Button>
        </div>
      </Field>
      {choosing && (
        <BackgroundPicker photos={photos} selectedId={cover.background?.photoId}
          onChoose={(photo) => { onChange(photo ? cover.withBackground({ photoId: photo.id, storagePath: photo.storagePath }) : cover.withoutBackground()); setChoosing(false); }}
          onClose={() => setChoosing(false)} />
      )}
    </GroupedSection>
  );
}

/** 背景写真の選び直し（写真の一覧から1枚。「使わない」で紺の単色） */
function BackgroundPicker({ photos, selectedId, onChoose, onClose }: {
  photos: readonly BackgroundPhoto[]; selectedId: string | undefined; onChoose: (photo: BackgroundPhoto | null) => void; onClose: () => void;
}) {
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const key = photos.map((p) => p.storagePath).join("|");
  useEffect(() => {
    viewUrls(key === "" ? [] : key.split("|")).then(setUrls, () => setUrls(new Map()));
  }, [key]);
  return (
    <div role="dialog" aria-label="背景写真を選ぶ" className="fixed inset-0 z-20 overflow-y-auto bg-grouped px-4 pb-8 pt-[max(0.5rem,env(safe-area-inset-top))]">
      <header className="-mx-4 mb-2 grid grid-cols-[1fr_auto_1fr] items-center px-2">
        <button type="button" onClick={onClose} className="min-h-11 justify-self-start px-2 text-[17px] text-tint active:opacity-60">キャンセル</button>
        <h1 className="text-[17px] font-semibold">背景写真を選ぶ</h1>
        <span />
      </header>
      <GroupedSection title="表紙に使う写真" footer={photos.length === 0 ? "背景写真がまだありません。管理者が登録すると選べます" : undefined}>
        <ul className="grid grid-cols-2 gap-2 p-2">
          {photos.map((p) => (
            <li key={p.id}>
              <button type="button" aria-pressed={p.id === selectedId} aria-label={p.description} onClick={() => onChoose(p)}
                className="block w-full overflow-hidden rounded-[8px] text-left ring-tint aria-pressed:ring-4">
                {urls.get(p.storagePath)
                  // eslint-disable-next-line @next/next/no-img-element -- 期限付き URL の画像（最適化しない）
                  ? <img src={urls.get(p.storagePath)} alt="" className="aspect-[4/5] w-full object-cover" />
                  : <div className="aspect-[4/5] w-full bg-fill" />}
                <span className="block truncate px-1 py-1 text-[13px]">{p.description}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="border-t border-separator p-2"><Button block onClick={() => onChoose(null)}>使わない（紺の単色）</Button></div>
      </GroupedSection>
    </div>
  );
}

/** S-07 ④ 中のスライドの編集: 見出し・説明文・強調する語・絵の指示・素材画像・削除 */
export function BodyFields({ body, bodyNumber, facts, canRemove, busy, onChange, onMakePicture, onReplaceImage, onRemoveImage, onRemove }: {
  body: BodyContent; bodyNumber: number; facts: readonly Fact[]; canRemove: boolean; busy: boolean;
  onChange: (body: BodyContent) => void; onMakePicture: () => void; onReplaceImage: (file: File) => void;
  onRemoveImage: () => void; onRemove: () => void;
}) {
  const { text, brief } = body;
  const issues = text.violationsByField();
  const briefIssues = PictureBrief.violationsOf(brief.promptText());
  const editText = (patch: Partial<{ heading: string; description: string; emphases: readonly string[] }>) =>
    onChange(body.withDraftText(SlideText.restore({ ...text, ...patch }), brief));
  const editBrief = (patch: Partial<{ prompt: string; replacementNeeded: boolean }>) =>
    onChange(body.withDraftText(text, PictureBrief.restore({ prompt: brief.promptText(), replacementNeeded: brief.needsReplacement(), ...patch })));
  const factsAt = (location: string) => facts.filter((f) => f.location === location).map((f) => f.fact);

  return (
    <GroupedSection title={`中のスライド${bodyNumber}の編集`} label="中のスライドの編集">
      <Field label="見出し" count={`${lengthOf(text.heading)} / ${SlideText.HEADING_MAX}`} violations={issues.heading} facts={factsAt("heading")}>
        <input aria-label="見出し" value={text.heading} onChange={(e) => editText({ heading: e.target.value })} className={INPUT} />
      </Field>
      <Field label="説明文" count={`${lengthOf(text.description)} / ${SlideText.DESCRIPTION_MAX}`} violations={issues.description} facts={factsAt("description")}>
        <textarea aria-label="説明文" rows={4} value={text.description} onChange={(e) => editText({ description: e.target.value })} className={INPUT} />
      </Field>
      <Field label={`強調する語（「、」で区切る・${SlideText.EMPHASES_MAX}か所まで）`} violations={issues.emphases}>
        <WordsInput label="強調する語" initial={text.emphases} separator={WORD_SEPARATOR} joiner="、" onChange={(emphases) => editText({ emphases })} />
      </Field>
      <Field label="絵の指示" count={`${lengthOf(brief.promptText())}文字`} violations={briefIssues}>
        <textarea aria-label="絵の指示" rows={2} value={brief.promptText()} onChange={(e) => editBrief({ prompt: e.target.value })} className={INPUT} />
        <label className="mt-2 flex min-h-9 items-center gap-2 text-[15px]">
          <input type="checkbox" checked={brief.needsReplacement()} onChange={(e) => editBrief({ replacementNeeded: e.target.checked })} className="h-5 w-5" />
          実物の画像への差し替えが必要
        </label>
      </Field>
      <MaterialField body={body} busy={busy} onMakePicture={onMakePicture} onReplaceImage={onReplaceImage} onRemoveImage={onRemoveImage} />
      <div className="border-t border-separator p-2">
        <Button variant="destructive" block disabled={!canRemove} onClick={onRemove}>このスライドを削除</Button>
        {!canRemove && <p className="pt-1 text-center text-[13px] text-secondary-label">中のスライドは1枚以上必要です</p>}
      </div>
    </GroupedSection>
  );
}

/** 素材画像: 今の画像、「絵を作る」「画像を差し替え」「画像を外す」 */
function MaterialField({ body, busy, onMakePicture, onReplaceImage, onRemoveImage }: {
  body: BodyContent; busy: boolean; onMakePicture: () => void; onReplaceImage: (file: File) => void; onRemoveImage: () => void;
}) {
  const material = body.material;
  const path = material?.storagePath;
  const [shown, setShown] = useState<{ path: string; url: string } | null>(null);
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    viewUrls([path]).then((urls) => { if (!cancelled) setShown({ path, url: urls.get(path) ?? "" }); }, () => undefined);
    return () => { cancelled = true; };
  }, [path]);
  const url = shown && shown.path === path ? shown.url : undefined;

  return (
    <Field label="素材画像" violations={[]}>
      {material ? (
        <div className="flex items-center gap-3">
          {url
            // eslint-disable-next-line @next/next/no-img-element -- 期限付き URL の画像（最適化しない）
            ? <img src={url} alt="素材画像" className="h-16 w-20 shrink-0 rounded-[8px] object-cover" />
            : <div className="h-16 w-20 shrink-0 rounded-[8px] bg-fill" />}
          <p className="text-[13px] text-secondary-label">
            {material.isGenerated() ? "AIで作った画像" : "差し替えた画像"}
            {material.requiresAiDisclosure() && "（写真風。公開時にAI生成の表示が付きます）"}
          </p>
        </div>
      ) : <p className="text-[13px] text-secondary-label">画像なし（文字だけのカードになります）</p>}
      <div className="grid grid-cols-2 gap-2 pt-2">
        <Button variant="tinted" disabled={busy} onClick={onMakePicture}>絵を作る</Button>
        <label className={`flex min-h-11 cursor-pointer items-center justify-center rounded-control bg-tint/15 px-4 py-2.5 text-[17px] font-semibold text-tint active:opacity-60 ${busy ? "pointer-events-none opacity-40" : ""}`}>
          画像を差し替え
          <input type="file" accept="image/jpeg,image/png,image/heic,image/heif" aria-label="画像を差し替え" className="sr-only"
            onChange={(e) => { const file = e.target.files?.[0]; if (file) onReplaceImage(file); e.target.value = ""; }} />
        </label>
      </div>
      {material && <div className="pt-1"><Button disabled={busy} onClick={onRemoveImage}>画像を外す</Button></div>}
    </Field>
  );
}
