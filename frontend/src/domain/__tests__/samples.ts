import caption from "../../../../docs/model/fixtures/caption.json";
import { CaptionFooter } from "../post/CaptionFooter";
import { FixedHashtags } from "../post/FixedHashtags";
import { GeneratedImage } from "../post/GeneratedImage";
import { PostStyleSettings } from "../post/PostStyleSettings";
import { BodyContent } from "../slide/BodyContent";
import { ClosingContent } from "../slide/ClosingContent";
import { CoverContent } from "../slide/CoverContent";
import { CoverText } from "../slide/CoverText";
import { MaterialImage } from "../slide/MaterialImage";
import { PictureBrief } from "../slide/PictureBrief";
import { Slide } from "../slide/Slide";
import { SlideList } from "../slide/SlideList";
import { SlideText } from "../slide/SlideText";

/** fixtures の項目の値: 文字列か、{repeat, count}（repeat を count 回つなぐ） */
export const valueOf = (value: string | { repeat: string; count: number }): string =>
  typeof value === "string" ? value : value.repeat.repeat(value.count);

/** テスト用のテンプレートの版の名前 */
export const SAMPLE_TEMPLATE_VERSION = "niijima@1";

/** テスト用の投稿の型の設定（キャプションの定型は caption.json の架空の文面） */
export const sampleSettings = (): PostStyleSettings => PostStyleSettings.of({
  tenantId: "t1", version: 1, bandText: "テスト帯", coverTargets: ["同志社大学", "同志社大生"],
  closingMessage: "最後までご覧くださりありがとうございます", accountIntroduction: "@test_account",
  captionFooter: CaptionFooter.of(caption.templateSettings.captionFooter),
  fixedHashtags: FixedHashtags.of(caption.templateSettings.fixedHashtags),
});

export const sampleCoverText = (): CoverText => CoverText.restore(
  { target: "同志社大学", keyword: "期末試験", annotation: "", closingWords: "まとめたよ", accentCode: "PURPLE" });

export const sampleBody = (material?: MaterialImage): BodyContent => BodyContent.of({
  text: SlideText.restore({ heading: "学割が使える", description: "学生証を見せるだけで割引になります。", emphases: ["学生証"] }),
  brief: PictureBrief.of({ prompt: "明るい雰囲気のカフェの背景", replacementNeeded: false }), material,
});

/** 生成画像（種類を指定）の素材画像。人が差し替えた画像なら style を省く */
export const sampleMaterial = (styleCode?: string): MaterialImage => MaterialImage.of({
  storagePath: "t/materials/1.jpg", width: 800, height: 600,
  generated: styleCode ? GeneratedImage.of({ generationId: "g1", candidatePosition: 1, styleCode }) : undefined,
});

/** 表紙1 → 中のスライド bodies.length 枚 → 最後のスライド1 のスライド構成 */
export const sampleSlides = (bodies: readonly BodyContent[] = [sampleBody()]): SlideList => SlideList.of([
  Slide.createCover(CoverContent.of(sampleCoverText(), { photoId: "bg1", storagePath: "t/backgrounds/1.jpg" })),
  ...bodies.map((b) => Slide.createBody(b)),
  Slide.createClosing(ClosingContent.empty()),
]);
