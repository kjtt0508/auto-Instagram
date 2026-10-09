"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useSession } from "@/components/session/SessionGate";
import { Button } from "@/components/ui/Button";
import { GroupedSection, Placeholder } from "@/components/ui/Grouped";
import { DraftProposal } from "@/domain/draft/DraftProposal";
import { Idea } from "@/domain/draft/Idea";
import type { LlmUsage } from "@/domain/draft/LlmUsage";
import { RevisionInstruction } from "@/domain/draft/RevisionInstruction";
import { unsupportedFactsInWork } from "@/domain/draft/unsupportedFacts";
import type { GeneratedImage } from "@/domain/post/GeneratedImage";
import type { PostStyleSettings } from "@/domain/post/PostStyleSettings";
import { BodyContent } from "@/domain/slide/BodyContent";
import { MaterialImage } from "@/domain/slide/MaterialImage";
import { PictureBrief } from "@/domain/slide/PictureBrief";
import { Slide } from "@/domain/slide/Slide";
import { SlideList } from "@/domain/slide/SlideList";
import { SlideText } from "@/domain/slide/SlideText";
import {
  currentDraftJson, DraftApiError, generateDraft, reviseDraft, type DraftResponse,
} from "@/lib/api/draftApi";
import { uploadDraftImage } from "@/lib/api/mediaStorage";
import { requestApproval, saveTemplateDraft } from "@/lib/api/postCommands";
import { currentStyleSettings, usableBackgroundPhotos, type BackgroundPhoto } from "@/lib/api/styleRepository";
import { forgetTemplateWork, recallTemplateWork, rememberTemplateWork } from "@/lib/api/templateDraftAutosave";
import { convertForInstagram } from "@/lib/image/imageConversion";
import { MATERIAL_ASPECT, CURRENT_TEMPLATE_VERSION } from "@/lib/template/templateRelease";
import {
  additionalHashtagsOf, EMPTY_TEMPLATE_WORK, isRevision, revisionOf, toDraftContent, withDraft, withMaterial, type TemplateWork,
} from "@/lib/template/templateWork";
import { ImageGenerationSheet, type ChosenCandidate } from "./ImageGenerationSheet";
import { ManualRelaySheet, type ManualRevision } from "./ManualRelaySheet";
import { NavigationBar } from "./NavigationBar";
import { BodyFields, CoverFields, type Fact } from "./SlideFields";
import { SlidePreview } from "./SlidePreview";
import { TemplateCaptionSection } from "./TemplateCaptionSection";

type Setup = { settings: PostStyleSettings | null; photos: BackgroundPhoto[] };
type Failure = { message: string; lines: string[]; manual: boolean; revising: boolean };

/**
 * S-07 AIで下書きを作る: ①ネタ ②生成 ③スライドのプレビュー ④選んだスライドの編集 ⑤キャプション ⑥修正指示と作り直す ⑦保存・承認を依頼。
 * 判断（文字数・強調する語・構成・キャプションの上限・ネタに無い情報）はドメインに尋ね、ここは入力と表示をつなぐ。
 * 新規の作成中の内容は端末に一時保存する（写真の投稿と同じ考え方）
 */
export function TemplatePostEditor({ postId, initial, title, chooser }: {
  postId: string | null; initial?: TemplateWork; title: string; chooser?: ReactNode;
}) {
  const { tenant, member } = useSession();
  const router = useRouter();
  const scope = { tenantId: tenant.id, memberId: member.id };
  // 保存できた投稿（承認の依頼に失敗したとき、次の保存は同じ投稿の新しい版にする。投稿が二重にできない）
  const [savedPostId, setSavedPostId] = useState<string | null>(null);
  const targetId = postId ?? savedPostId;
  const [recalled] = useState(() => (postId === null && !initial ? recallTemplateWork(scope) : null));
  const [work, setWork] = useState<TemplateWork>(() => initial ?? recalled ?? EMPTY_TEMPLATE_WORK);
  const [restored, setRestored] = useState(recalled !== null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [usage, setUsage] = useState<LlmUsage | null>(null);
  const [instruction, setInstruction] = useState("");
  const [instructionError, setInstructionError] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [sheet, setSheet] = useState<"picture" | "manual" | null>(null);
  const [manualRevision, setManualRevision] = useState<ManualRevision | undefined>(undefined);

  useEffect(() => {
    Promise.all([currentStyleSettings(), usableBackgroundPhotos()]).then(
      ([settings, photos]) => setSetup({ settings, photos }), (e: Error) => setSetupError(e.message));
  }, []);

  const update = (patch: Partial<TemplateWork>) => {
    const next = { ...work, ...patch };
    setWork(next);
    if (targetId === null) rememberTemplateWork(scope, next);
  };

  const settings = setup?.settings ?? null;
  const slides = work.slides;
  const tags = additionalHashtagsOf(work);
  const revision = revisionOf(work, settings);
  // 編集中の既存の投稿はネタを持たない（ネタに無い情報は、ネタがあるときだけ確かめる）
  const facts = slides && work.ideaText !== "" ? unsupportedFactsInWork(work.ideaText, slides, work.captionText) : [];
  const ideaIssues = work.ideaText === "" ? [] : Idea.violationsOf(work.ideaText);
  const ideaRemaining = Idea.TEXT_MAX - [...work.ideaText].length;

  /** 下書き案を取り込む。最初の生成（と手動コピペの新規）はスライドごと置き換え、修正は文言だけを取り込む（素材画像・背景写真・PR区分は保つ） */
  const apply = (response: DraftResponse) => {
    if (!settings || !setup) return;
    const parsed = DraftProposal.parse(response.proposal, { settings, prLabel: tenant.prLabel, sourceUrlRequired: false });
    if (!parsed.proposal) throw new Error(parsed.violations.join("\n"));
    // 取り込み方（置き換えか文言だけか）は作業中の内容が決める
    if (!isRevision(work, response)) setSelected(0);
    update(withDraft(work, parsed.proposal, response, setup.photos));
    setUsage(response.usage);
    setFailure(null);
  };

  const failureOf = (e: unknown, revising: boolean): Failure => e instanceof DraftApiError
    ? { message: e.message, lines: e.details, manual: e.canContinueManually(), revising }
    : { message: (e as Error).message, lines: [], manual: false, revising };

  const generate = async () => {
    setBusy("生成しています…（30秒ほどかかります）");
    setFailure(null);
    try {
      apply(await generateDraft(work.ideaText));
    } catch (e) {
      setFailure(failureOf(e, false));
      // 記録されたネタは、手動コピペで同じものを使い続ける
      if (e instanceof DraftApiError && e.ideaId) update({ ideaId: e.ideaId });
    } finally {
      setBusy(null);
    }
  };

  const revise = async () => {
    if (!slides || !work.generationId) return;
    const issues = RevisionInstruction.violationsOf(instruction);
    if (issues.length > 0) return setInstructionError(issues[0]);
    setInstructionError(null);
    setBusy("作り直しています…（30秒ほどかかります）");
    setFailure(null);
    try {
      apply(await reviseDraft(work.generationId, instruction, currentDraftJson({ slides, ...stateOf(work) })));
      setInstruction("");
    } catch (e) {
      setFailure(failureOf(e, true));
    } finally {
      setBusy(null);
    }
  };

  const continueManually = () => {
    setManualRevision(failure?.revising && slides && work.generationId
      ? { parentGenerationId: work.generationId, instruction, current: currentDraftJson({ slides, ...stateOf(work) }) } : undefined);
    setSheet("manual");
  };

  const replaceSlide = (index: number, slide: Slide) => {
    if (slides) update({ slides: slides.withSlideReplaced(index, slide) });
  };

  /** 素材画像を4:3に切り取って保存し、選んだ中のスライドに載せる（容量は素材画像が持つ） */
  const adoptMaterial = async (index: number, image: Blob, generated?: GeneratedImage) => {
    if (!slides?.items()[index]?.bodyContent()) return;
    const converted = await convertForInstagram(image, { aspect: MATERIAL_ASPECT, focus: 0.5 });
    const storagePath = await uploadDraftImage(tenant, converted.blob);
    const material = MaterialImage.of({ storagePath, width: converted.width, height: converted.height, byteSize: converted.blob.size, generated });
    update(withMaterial(work, index, material));
  };

  const replaceImage = async (index: number, file: File) => {
    setBusy("画像を変換しています…");
    setErrors([]);
    try {
      await adoptMaterial(index, file);
    } catch (e) {
      setErrors([(e as Error).message]);
    } finally {
      setBusy(null);
    }
  };

  const chooseCandidate = async (chosen: ChosenCandidate[]) => {
    if (chosen[0]) await adoptMaterial(selected, chosen[0].image, chosen[0].candidate.adopted());
  };

  const addBody = () => {
    if (!slides) return;
    const added = slides.withBodyAdded(BodyContent.of({
      text: SlideText.restore({ heading: "", description: "", emphases: [] }),
      brief: PictureBrief.restore({ prompt: "", replacementNeeded: false }),
    }));
    update({ slides: added });
    setSelected(added.count() - 2);
  };

  const removeSelected = () => {
    if (!slides) return;
    update({ slides: slides.withoutSlideAt(selected) });
    setSelected(0);
  };

  const save = async (alsoRequestApproval: boolean) => {
    if (!slides || !revision) return;
    // 人の書き換えにも AI の出力と同じ検査をかけ、満たさなければ保存しない（BR-002-18）。承認の依頼も同じ条件
    const violations = alsoRequestApproval ? revision.violationsForApproval(tenant.prLabel) : revision.violationsForSaving(tenant.prLabel);
    if (violations.length > 0) return setErrors(violations);
    setSaving(true);
    setErrors([]);
    try {
      const saved = await saveTemplateDraft(targetId, toDraftContent({ ...work, slides }));
      setSavedPostId(saved.postId);
      forgetTemplateWork(scope);
      if (alsoRequestApproval) await requestApproval(saved.postId, saved.revisionId);
      router.push(`/posts/view/?id=${encodeURIComponent(saved.postId)}`);
    } catch (e) {
      setErrors([(e as Error).message]);
      setSaving(false);
    }
  };

  const discardRestored = () => {
    forgetTemplateWork(scope);
    setWork(EMPTY_TEMPLATE_WORK);
    setRestored(false);
  };

  const selectedSlide = slides?.items()[selected];
  const cover = selectedSlide?.coverContent();
  const body = selectedSlide?.bodyContent();
  const bodyNumber = slides?.bodyNumberAt(selected) ?? 0;
  const factsFor = (prefix: string): Fact[] => facts.filter((f) => f.location.startsWith(prefix))
    .map((f) => ({ ...f, location: f.location.slice(prefix.length) }));
  const editing = busy !== null || saving;

  return (
    <div className="pb-24">
      <NavigationBar title={title} onCancel={() => router.back()} />
      {chooser}
      {restored && (
        <p className="mt-2 flex items-center justify-between rounded-cell bg-cell px-4 py-2 text-[15px]">
          前回の入力を復元しました
          <button type="button" onClick={discardRestored} className="min-h-9 px-2 text-destructive">消す</button>
        </p>
      )}
      {setupError && <Placeholder tone="error">{setupError}</Placeholder>}
      {setup && !settings && <Placeholder tone="error">投稿の型の設定がありません。管理者に設定を依頼してください</Placeholder>}

      <GroupedSection title={`ネタ（${[...work.ideaText].length} / ${Idea.TEXT_MAX}文字）`} label="ネタ"
        footer={<IdeaFooter remaining={ideaRemaining} issues={ideaIssues} regenerating={slides !== null} />}>
        <textarea aria-label="ネタ" rows={5} value={work.ideaText} disabled={editing} onChange={(e) => update({ ideaText: e.target.value })}
          placeholder="投稿の元になる情報を箇条書きで（日時・場所・内容など）" className="block w-full resize-y bg-transparent px-4 py-3 text-[17px] outline-none" />
      </GroupedSection>
      <div className="mt-3 space-y-2">
        <GenerationButtons failure={failure && !failure.revising ? failure : null} busy={busy !== null}
          canGenerate={settings !== null && work.ideaText !== "" && ideaIssues.length === 0} onGenerate={generate} onManual={continueManually} />
        {busy && <p role="status" className="text-center text-[15px] text-secondary-label">{busy}</p>}
        {failure && !failure.revising && <FailureNote failure={failure} />}
        {usage?.shouldWarn() && (
          <p role="note" className="px-1 text-[13px] text-destructive">
            今日のAI生成は上限に近づいています（{usage.used} / {usage.quota.dailyLimit}回）。上限に達しても手動コピペで続けられます
          </p>
        )}
      </div>

      {slides && settings && setup && revision && (
        <fieldset disabled={editing} className="min-w-0">
          <SlidePreview slides={slides} settings={settings} templateVersion={CURRENT_TEMPLATE_VERSION} selectedIndex={selected} onSelect={setSelected} />
          <div className="mt-2"><Button variant="tinted" block disabled={!slides.canAddBody()} onClick={addBody}>中のスライドを追加</Button></div>
          {!slides.canAddBody() && <p className="pt-1 text-center text-[13px] text-secondary-label">中のスライドは{SlideList.BODY_MAX}枚までです</p>}

          {cover && <CoverFields key={`${selected}:${work.generationId}`} cover={cover} settings={settings} photos={setup.photos}
            facts={facts} onChange={(next) => replaceSlide(selected, Slide.createCover(next))} />}
          {body && (
            <BodyFields key={`${selected}:${work.generationId}`} body={body} bodyNumber={bodyNumber} facts={factsFor(`slides[${bodyNumber - 1}].`)}
              canRemove={slides.canRemoveBody()} busy={busy !== null}
              onChange={(next) => replaceSlide(selected, Slide.createBody(next))} onMakePicture={() => setSheet("picture")}
              onReplaceImage={(file) => replaceImage(selected, file)}
              onRemoveImage={() => replaceSlide(selected, Slide.createBody(body.withoutMaterial()))} onRemove={removeSelected} />
          )}

          <TemplateCaptionSection key={work.generationId ?? "new"} revision={revision} settings={settings} prLabel={tenant.prLabel}
            captionText={work.captionText} hashtags={tags} prCategory={work.prCategory} facts={facts}
            onCaption={(captionText) => update({ captionText })}
            onHashtags={(words) => update({ hashtagText: words.join(" ") })}
            onPrCategory={(prCategory) => update({ prCategory })} />

          {work.generationId && (
            <GroupedSection title="修正指示で文言を作り直す" label="修正指示"
              footer="文言だけを作り直します。素材画像・背景写真・PR区分は保たれます（中のスライドの枚数も変わりません）">
              <textarea aria-label="修正指示" rows={3} value={instruction} onChange={(e) => setInstruction(e.target.value)}
                placeholder="例: もっとくだけた感じで" className="block w-full resize-y bg-transparent px-4 py-3 text-[17px] outline-none" />
              <div className="border-t border-separator p-2">
                <GenerationButtons failure={failure?.revising ? failure : null} busy={busy !== null} label="作り直す"
                  canGenerate={instruction.trim() !== ""} onGenerate={revise} onManual={continueManually} />
              </div>
              {instructionError && <p className="px-4 pb-2 text-[13px] text-destructive">{instructionError}</p>}
              {failure?.revising && <div className="px-4 pb-2"><FailureNote failure={failure} /></div>}
            </GroupedSection>
          )}
        </fieldset>
      )}

      {errors.length > 0 && (
        <ul className="mt-4 space-y-1 px-4">{errors.map((e) => <li key={e} role="alert" className="text-[15px] text-destructive">{e}</li>)}</ul>
      )}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-separator bg-bar pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
        <div className="mx-auto grid max-w-xl grid-cols-[auto_1fr] gap-2 px-4 py-2">
          <Button variant="plain" disabled={editing || !revision} onClick={() => save(false)}>保存</Button>
          <Button variant="filled" disabled={editing || !revision} onClick={() => save(true)}>承認を依頼</Button>
        </div>
      </div>

      {sheet === "picture" && body && (
        <ImageGenerationSheet maxChoices={1} initialPrompt={body.brief.promptText()} onChoose={chooseCandidate} onClose={() => setSheet(null)} />
      )}
      {sheet === "manual" && (
        <ManualRelaySheet ideaId={work.ideaId} ideaText={work.ideaText} revision={manualRevision}
          onImported={(response) => { try { apply(response); setSheet(null); } catch (e) { setFailure(failureOf(e, false)); setSheet(null); } }}
          onClose={() => setSheet(null)} />
      )}
    </div>
  );
}

const stateOf = (work: TemplateWork) => ({
  captionText: work.captionText, additionalHashtags: additionalHashtagsOf(work), prCategory: work.prCategory, sourceUrls: work.sourceUrls,
});

function IdeaFooter({ remaining, issues, regenerating }: { remaining: number; issues: readonly string[]; regenerating: boolean }) {
  return (
    <>
      <span className="block text-right">残り {remaining.toLocaleString("ja-JP")} 文字</span>
      {issues.map((v) => <span key={v} data-violation="ネタ" className="block text-destructive">{v}</span>)}
      {regenerating && <span className="block">「生成」し直すと、今の内容は新しい案に置き換わります。文言だけ直すときは「作り直す」を使います</span>}
    </>
  );
}

/** 生成（作り直す）ボタン。続けられない理由（上限・障害・出力の不備）のときは、手動コピペで続けるを主ボタンにする */
function GenerationButtons({ failure, busy, canGenerate, label = "生成", onGenerate, onManual }: {
  failure: Failure | null; busy: boolean; canGenerate: boolean; label?: string; onGenerate: () => void; onManual: () => void;
}) {
  const manualFirst = failure?.manual === true;
  return (
    <div className={manualFirst ? "flex flex-col gap-2" : undefined}>
      {manualFirst && <Button variant="filled" block disabled={busy} onClick={onManual}>手動コピペで続ける</Button>}
      <Button variant={manualFirst ? "tinted" : "filled"} block disabled={busy || !canGenerate} onClick={onGenerate}>{label}</Button>
    </div>
  );
}

function FailureNote({ failure }: { failure: Failure }) {
  return (
    <div role="alert" className="px-1 text-[15px] text-destructive">
      <p>{failure.message}</p>
      {failure.lines.length > 0 && <ul className="list-disc pl-5 pt-1 text-[13px]">{failure.lines.map((l) => <li key={l}>{l}</li>)}</ul>}
    </div>
  );
}
