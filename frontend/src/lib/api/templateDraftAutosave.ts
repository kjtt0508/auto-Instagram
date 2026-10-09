import { GeneratedImage } from "@/domain/post/GeneratedImage";
import { PrCategory } from "@/domain/post/PrCategory";
import { BodyContent } from "@/domain/slide/BodyContent";
import { ClosingContent } from "@/domain/slide/ClosingContent";
import { CoverContent } from "@/domain/slide/CoverContent";
import { CoverText } from "@/domain/slide/CoverText";
import { MaterialImage } from "@/domain/slide/MaterialImage";
import { PictureBrief } from "@/domain/slide/PictureBrief";
import { Slide } from "@/domain/slide/Slide";
import { SlideList } from "@/domain/slide/SlideList";
import { SlideText } from "@/domain/slide/SlideText";
import type { TemplateWork } from "@/lib/template/templateWork";
import { ownsPath, scopedKey, type AutosaveScope } from "./autosaveScope";

// 作成中のAIで作る投稿（S-07）を端末（localStorage）に一時保存する。draftAutosave（写真の投稿）と同じ考え方:
// カメラやファイルを開いて戻ったとき、画面が再読み込みされたときに入力を失わない。保存（RPC）できたら消す。端末の外には出さない
// キーに団体IDとメンバーIDを含め、復元のときは保存先が自団体のものか確かめる（autosaveScope）
const keyOf = (scope: AutosaveScope) => scopedKey("template-draft", scope);

type StoredBody = {
  heading: string; description: string; emphases: string[]; prompt: string; replacementNeeded: boolean;
  material?: { storagePath: string; width: number; height: number; byteSize: number; generated?: { generationId: string; candidatePosition: number; styleCode: string } };
};
type Stored = Omit<TemplateWork, "slides" | "prCategory"> & {
  prCategory: string;
  slides: null | {
    cover: { target: string; keyword: string; annotation: string; closingWords: string; accent: string; background?: { photoId: string; storagePath: string } };
    bodies: StoredBody[];
  };
};

/** 一時保存したスライドが指す保存先（背景写真・素材画像）。復元の前に自団体のものか確かめる */
const storedPathsOf = (slides: NonNullable<Stored["slides"]>): string[] => [
  ...(slides.cover.background ? [slides.cover.background.storagePath] : []),
  ...slides.bodies.flatMap((b) => (b.material ? [b.material.storagePath] : [])),
];

function toStoredBody(body: BodyContent): StoredBody {
  const { heading, description, emphases } = body.text;
  const material = body.material;
  const generated = material?.generatedImage();
  return {
    heading, description, emphases: [...emphases], prompt: body.brief.promptText(), replacementNeeded: body.brief.needsReplacement(),
    material: material ? { storagePath: material.storagePath, ...material.dimensions(), byteSize: material.byteSize,
      generated: generated ? { generationId: generated.generationId, candidatePosition: generated.candidatePosition, styleCode: generated.style.code } : undefined } : undefined,
  };
}

function fromStored(slides: NonNullable<Stored["slides"]>): SlideList {
  const c = slides.cover;
  return SlideList.restore([
    Slide.createCover(CoverContent.of(CoverText.restore({ target: c.target, keyword: c.keyword, annotation: c.annotation,
      closingWords: c.closingWords, accentCode: c.accent }), c.background)),
    ...slides.bodies.map((b) => Slide.createBody(BodyContent.of({
      text: SlideText.restore({ heading: b.heading, description: b.description, emphases: b.emphases }),
      brief: PictureBrief.restore({ prompt: b.prompt, replacementNeeded: b.replacementNeeded }),
      material: b.material ? MaterialImage.of({ ...b.material, generated: b.material.generated ? GeneratedImage.of(b.material.generated) : undefined }) : undefined,
    }))),
    Slide.createClosing(ClosingContent.empty()),
  ]);
}

export function rememberTemplateWork(scope: AutosaveScope, work: TemplateWork): void {
  const [cover, ...rest] = work.slides?.items() ?? [];
  const coverText = cover?.coverContent();
  const stored: Stored = {
    ...work, prCategory: work.prCategory.code,
    slides: coverText ? {
      cover: { target: coverText.text.target, keyword: coverText.text.keyword, annotation: coverText.text.annotation,
        closingWords: coverText.text.closingWords, accent: coverText.text.accent.code, background: coverText.background },
      bodies: rest.flatMap((s) => s.bodyContent() ?? []).map(toStoredBody),
    } : null,
  };
  try {
    localStorage.setItem(keyOf(scope), JSON.stringify(stored));
  } catch {
    // 保存できない端末（プライベートブラウズ等）では一時保存しない
  }
}

/** 一時保存した内容。無ければ・壊れていれば・何も入力していなければ null */
export function recallTemplateWork(scope: AutosaveScope): TemplateWork | null {
  try {
    const stored = JSON.parse(localStorage.getItem(keyOf(scope)) ?? "null") as Stored | null;
    if (!stored || (stored.ideaText === "" && stored.slides === null)) return null;
    if (stored.slides && !storedPathsOf(stored.slides).every((p) => ownsPath(scope, p))) return null;
    return { ...stored, prCategory: PrCategory.from(stored.prCategory), slides: stored.slides ? fromStored(stored.slides) : null };
  } catch {
    return null;
  }
}

/** 一時保存した作成中の内容があるか（S-03 が最初に開く方を決める） */
export function hasTemplateWork(scope: AutosaveScope): boolean {
  return recallTemplateWork(scope) !== null;
}

export function forgetTemplateWork(scope: AutosaveScope): void {
  try {
    localStorage.removeItem(keyOf(scope));
  } catch {
    // 何もしない
  }
}
