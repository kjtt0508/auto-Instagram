import { supabase } from "./supabase";

// 生成した背景を背景写真にする（REQ-006 設計 4章）。API関数 POST /api/background-photos を1回呼ぶだけ。
// 候補の画像の複製・記録・30枚の検査はサーバーが行う（画面は画像を取得・変換・アップロードしない）

/** 背景写真になった写真（新しく登録した場合も、同じ候補がすでに背景写真だった場合も同じ形） */
export type AdoptedBackground = { photoId: string; storagePath: string; description: string };

/**
 * API関数が拒んだ理由。`code` はサーバーのエラーコード（CANDIDATE_GONE・BACKGROUND_LIMIT_REACHED・NOT_ADOPTABLE ほか）。
 * 画面は用途（表紙の背景）に合わせて、コードから案内の文言に読み替えられる
 */
export class BackgroundPhotoApiError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "BackgroundPhotoApiError";
  }
}

const FAILED = "背景を登録できませんでした。時間を置いてお試しください";

const isAdopted = (body: unknown): body is AdoptedBackground => {
  const adopted = body as Partial<AdoptedBackground> | null;
  return typeof adopted?.photoId === "string" && typeof adopted.storagePath === "string" && typeof adopted.description === "string";
};

/** 画像生成の候補を、背景写真にする。成功（201 新規・200 すでに登録済み）のときは背景写真の ID・保存先・説明文 */
export async function adoptGeneratedBackground(request: {
  generationId: string; candidatePosition: number; description: string;
}): Promise<AdoptedBackground> {
  const { data } = await supabase().auth.getSession();
  let response: Response;
  try {
    response = await fetch("/api/background-photos", {
      method: "POST",
      headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        generationId: request.generationId, candidatePosition: request.candidatePosition, description: request.description,
      }),
    });
  } catch {
    throw new BackgroundPhotoApiError("背景を登録できませんでした。通信を確かめて、もう一度お試しください", "NETWORK");
  }
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (json as { error?: { code?: string; message?: string } } | null)?.error;
    throw new BackgroundPhotoApiError(error?.message ?? FAILED, error?.code ?? "INTERNAL");
  }
  if (!isAdopted(json)) throw new BackgroundPhotoApiError(FAILED, "INTERNAL");
  return { photoId: json.photoId, storagePath: json.storagePath, description: json.description };
}
