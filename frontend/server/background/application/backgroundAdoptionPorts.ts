import type { ImageStyle } from "../../../src/domain/post/ImageStyle";

// 生成した背景を背景写真にする（REQ-006）でアプリケーションが使う外部のインターフェース。実装は infrastructure（P16）

export type RequestingMember = { memberId: string; tenantId: string };

/** 採用できる候補かを判断するために読む、画像生成の記録 */
export type StoredImageGeneration = { tenantId: string; style: ImageStyle; succeeded: boolean; candidateCount: number };

/** 候補の画像の場所（団体・画像生成・位置） */
export type CandidateLocation = { tenantId: string; generationId: string; candidatePosition: number };

/** 背景写真（記録から読んだ値） */
export type StoredBackgroundPhoto = { id: string; tenantId: string; storagePath: string; description: string };

/** 背景写真としての採用の記録。usable=false は、管理者が「使わない」にした背景写真 */
export type StoredAdoption = { photo: StoredBackgroundPhoto; usable: boolean };

/** 背景写真として記録する内容（record_generated_background の引数に対応する） */
export type BackgroundRecording = { storagePath: string; generationId: string; candidatePosition: number; description: string };

/** 画像生成・背景写真・背景写真としての採用の読み書き（service role で Supabase を読み書きする） */
export interface BackgroundAdoptionRecords {
  memberOf(accessToken: string): Promise<RequestingMember | null>;
  generationOf(generationId: string): Promise<StoredImageGeneration | null>;
  /** その候補を背景写真にした記録があれば、その背景写真（自団体のものだけ）と、いま使っているか（「使わない」にしていないか） */
  adoptionOf(tenantId: string, generationId: string, candidatePosition: number): Promise<StoredAdoption | null>;
  photoOf(tenantId: string, photoId: string): Promise<StoredBackgroundPhoto | null>;
  /** 背景写真として記録する。DB が拒否したときは BackgroundRecordingRefused。同じ候補がすでに背景写真なら、既存の背景写真IDを返す */
  record(member: RequestingMember, recording: BackgroundRecording): Promise<string>;
}

/** 候補の画像と背景写真の画像（Storage。service role で扱う） */
export interface BackgroundImageStore {
  candidateExists(candidate: CandidateLocation): Promise<boolean>;
  /** 候補の画像を、背景写真の保存先に複製する（画像は加工しない）。複製先の保存先を返す */
  copyCandidate(candidate: CandidateLocation, fileId: string): Promise<string>;
  remove(storagePath: string): Promise<void>;
}

/** 記録（RPC）が背景写真にすることを断った理由。上限（30枚）／団体・メンバーが無い／保存先の形／それ以外（採用できない候補・説明文の形など） */
export class BackgroundRecordingRefused extends Error {
  constructor(readonly reason: "LIMIT_REACHED" | "NOT_FOUND" | "STORAGE_PATH" | "NOT_ADOPTABLE", message: string) {
    super(message);
  }
}

/** 背景写真にできなかった理由（REQ-006 設計 4章のエラー）。presentation が HTTP に変える */
export class BackgroundAdoptionRefusal extends Error {
  constructor(
    readonly code: "INVALID_REQUEST" | "FORBIDDEN" | "NOT_FOUND" | "NOT_ADOPTABLE" | "CANDIDATE_GONE"
      | "BACKGROUND_LIMIT_REACHED" | "STORAGE_FAILED",
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
  }
}
