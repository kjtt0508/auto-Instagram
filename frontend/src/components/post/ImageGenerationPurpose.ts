import { ImageStyle } from "@/domain/post/ImageStyle";
import { BackgroundPhoto, BackgroundPhotoList } from "@/domain/slide/BackgroundPhotoList";

/**
 * S-13 画像を生成する の用途ごとの設定（REQ-006 設計 3章）。業務の概念ではなく画面の設定なので、用語集には無い。
 * 用途ごとの違い（選べる画像の種類・枚数・確定ボタンの名前・説明文の欄・案内の文言）をここに集め、
 * ImageGenerationSheet は表を受け取るだけにする（画面部品の中に用途の分岐を散らさない）。
 * サーバーは用途を知らないので、エラーコードから用途ごとの案内への読み替えもここに置く
 */
export type ImageGenerationPurposeSettings = {
  readonly code: "POST_IMAGE" | "MATERIAL_IMAGE" | "COVER_BACKGROUND";
  /** 画面の見出し */
  readonly title: string;
  /** 指示の入力欄の例 */
  readonly promptPlaceholder: string;
  /** 選べる画像の種類。1つだけなら固定の表示にする（選べない） */
  readonly styles: readonly ImageStyle[];
  /** 選べる枚数（呼び出し元が空けられる枚数 `slots` を受け取る） */
  readonly maxChoices: (slots: number) => number;
  /** 確定ボタンの名前（選んだ枚数つき） */
  readonly confirmLabel: (selectedCount: number) => string;
  /** 確定の処理中に出す文言 */
  readonly choosingMessage: string;
  /** 候補の画像のバイト列が要るか（要らないなら、サーバーが候補を複製する） */
  readonly needsImageBytes: boolean;
  /** 説明文の欄。無ければ null */
  readonly description: {
    readonly label: string;
    /** 生成の指示から作る、欄の初めの値 */
    readonly initialValue: (prompt: string) => string;
    readonly violationsOf: (description: string) => string[];
  } | null;
  /** 今日の画像生成の回数が上限に達しているときの案内 */
  readonly usageLimitNotice: string;
  /** サーバーのエラーコード → この用途での案内。無いコードはサーバーの文言をそのまま出す */
  readonly messages: Readonly<Record<string, string>>;
};

const ILLUSTRATION_ONLY = [ImageStyle.ILLUSTRATION] as const;
const BACKGROUND_UNAVAILABLE = "いまは背景を作れません。登録した背景写真から選んでください";
const PHOTO_LIMIT = `背景写真が${BackgroundPhotoList.MAX}枚です。管理者が使わない写真を整理してください`;

const confirmWithCount = (selectedCount: number) => `選んだ画像を使う${selectedCount > 0 ? `（${selectedCount}）` : ""}`;

const POST_IMAGE: ImageGenerationPurposeSettings = {
  code: "POST_IMAGE",
  title: "AIで画像を作る",
  promptPlaceholder: "例: 桜並木のやわらかい水彩風の背景",
  styles: ImageStyle.all(),
  maxChoices: (slots) => slots,
  confirmLabel: confirmWithCount,
  choosingMessage: "画像を投稿用に変換しています…",
  needsImageBytes: true,
  description: null,
  usageLimitNotice: "今日の画像生成は上限に達しました。写真を撮る・選ぶで続けてください",
  messages: {},
};

const MATERIAL_IMAGE: ImageGenerationPurposeSettings = { ...POST_IMAGE, code: "MATERIAL_IMAGE", maxChoices: () => 1 };

const COVER_BACKGROUND: ImageGenerationPurposeSettings = {
  code: "COVER_BACKGROUND",
  title: "AIで背景を作る",
  promptPlaceholder: "例: 夕暮れの京都御苑、やわらかい光",
  styles: ILLUSTRATION_ONLY,   // 写真風は無い（AI生成の表示が付くため。REQ-006 BR-006-03）
  maxChoices: () => 1,
  confirmLabel: () => "この背景を使う",
  choosingMessage: "背景を登録しています…",
  needsImageBytes: false,      // サーバーが候補の画像を複製する。画面は取得も変換もしない
  description: {
    label: "背景写真の説明文",
    initialValue: (prompt) => BackgroundPhoto.initialDescription(prompt),
    violationsOf: (description) => BackgroundPhoto.violationsOfDescription(description),
  },
  usageLimitNotice: "今日の画像生成は上限に達しました。登録した背景写真から選んでください",
  messages: {
    IMAGE_LIMIT_REACHED: "今日の画像生成は上限に達しました。登録した背景写真から選んでください",
    TRANSLATION_UNAVAILABLE: BACKGROUND_UNAVAILABLE,
    GENERATION_FAILED: BACKGROUND_UNAVAILABLE,
    GENERATION_TIMEOUT: BACKGROUND_UNAVAILABLE,
    BACKGROUND_LIMIT_REACHED: PHOTO_LIMIT,
    CANDIDATE_GONE: "候補の期限が切れました。作り直してください",
  },
};

export const ImageGenerationPurpose = { POST_IMAGE, MATERIAL_IMAGE, COVER_BACKGROUND } as const;
export type ImageGenerationPurpose = ImageGenerationPurposeSettings;

/** 背景写真が上限（30枚）のときの案内（背景写真の選び直しの画面でも使う） */
export const BACKGROUND_PHOTO_LIMIT_NOTICE = PHOTO_LIMIT;

/** 失敗の理由を、この用途での案内にする。用途の表にあるコードはそちらの文言、無ければ（コードの無いエラーも）エラー自身の文言 */
export function explainFailure(purpose: ImageGenerationPurpose, error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  const message = typeof code === "string" && Object.hasOwn(purpose.messages, code) ? purpose.messages[code] : undefined;
  return message ?? (error instanceof Error ? error.message : "処理に失敗しました。時間を置いてお試しください");
}
