import { ImageGeneration } from "../../../src/domain/image/ImageGeneration";
import { ImageStyle } from "../../../src/domain/post/ImageStyle";
import { BackgroundPhoto } from "../../../src/domain/slide/BackgroundPhotoList";
import {
  BackgroundAdoptionRefusal, BackgroundRecordingRefused, type BackgroundAdoptionRecords, type BackgroundImageStore,
  type RequestingMember, type StoredAdoption, type StoredBackgroundPhoto,
} from "./backgroundAdoptionPorts";

// 生成した背景を背景写真にする（REQ-006 設計 4章）。
// ①メンバー → ②説明文・位置の形 → ③画像生成（自団体・成功・候補の数以内・背景・イラスト）→ ④すでに採用済みなら既存を返す
// → ⑤候補の画像が残っているか → ⑥複製 → ⑦記録（RPC）→ ⑧記録が確定して断られたら複製を消す（結果が分からない失敗は、記録を読んで確かめる）

/** 縮退した失敗の理由をログに残す。infrastructure の例外の文言は状態コードだけにしてあるので、鍵は含まれない */
function warn(what: string, e: unknown): void {
  console.warn(`[background-adoption] ${what}: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
}

const GENERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 背景写真にできる画像の種類（写真風は実物の写真と見分けがつかないので使わない。REQ-006 BR-006-03） */
const BACKGROUND_STYLE = ImageStyle.ILLUSTRATION;

/** 記録（RPC）の拒否の理由から、利用者に返す失敗への対応 */
const REFUSALS: Record<BackgroundRecordingRefused["reason"], BackgroundAdoptionRefusal> = {
  LIMIT_REACHED: new BackgroundAdoptionRefusal("BACKGROUND_LIMIT_REACHED", "背景写真が30枚です。管理者が使わない写真を整理してください"),
  NOT_FOUND: new BackgroundAdoptionRefusal("NOT_FOUND", "画像生成が見つかりません"),
  STORAGE_PATH: new BackgroundAdoptionRefusal("STORAGE_FAILED", "画像の保存先でエラーが起きました。時間を置いてお試しください"),
  NOT_ADOPTABLE: new BackgroundAdoptionRefusal("NOT_ADOPTABLE", "この候補は背景写真にできません"),
};

export type AdoptedBackground = { photoId: string; storagePath: string; description: string };

/** created: 新しく背景写真にした（201）／false: すでに背景写真になっていた（200） */
export type BackgroundAdoption = { created: boolean; background: AdoptedBackground };

export class BackgroundPhotoAdopting {
  constructor(private readonly deps: {
    records: BackgroundAdoptionRecords; images: BackgroundImageStore; newId: () => string;
  }) {}

  async adopt(accessToken: string, request: { generationId: string; candidatePosition: number; description: string }): Promise<BackgroundAdoption> {
    const member = await this.requireMember(accessToken);
    const { description, position } = this.parse(request);
    await this.requireAdoptable(member, request.generationId, position);

    const existing = await this.deps.records.adoptionOf(member.tenantId, request.generationId, position);
    if (existing) return this.alreadyAdopted(existing);

    await this.requireCandidateImage(member, request.generationId, position);
    const storagePath = await this.copyCandidate(member, request.generationId, position);
    const photo = await this.recordOrDiscard(member, { storagePath, generationId: request.generationId, candidatePosition: position, description });
    return photo.storagePath === storagePath
      ? { created: true, background: this.shown(photo) }
      : await this.discardLostCopy(storagePath, photo);
  }

  private async requireMember(accessToken: string): Promise<RequestingMember> {
    const member = await this.deps.records.memberOf(accessToken);
    if (!member) throw new BackgroundAdoptionRefusal("FORBIDDEN", "利用が許可されていません");
    return member;
  }

  /** ②説明文の検査はドメイン（BackgroundPhoto）に委ねる。位置は整数だけ（候補の数との比較は画像生成を読んでから） */
  private parse(request: { candidatePosition: number; description: string }) {
    const violations = BackgroundPhoto.violationsOfDescription(request.description);
    if (violations.length > 0) throw new BackgroundAdoptionRefusal("INVALID_REQUEST", violations[0], violations);
    if (!Number.isInteger(request.candidatePosition) || request.candidatePosition < 1) {
      throw new BackgroundAdoptionRefusal("INVALID_REQUEST", "候補の位置が正しくありません", ["候補の位置が正しくありません"]);
    }
    return { description: request.description.trim(), position: request.candidatePosition };
  }

  /** ③他団体・存在しない画像生成は「無い」と同じ扱い（404）。失敗した画像生成・位置が候補の数を超える・写真風は採用できない（409） */
  private async requireAdoptable(member: RequestingMember, generationId: string, position: number): Promise<void> {
    const generation = GENERATION_ID.test(generationId) ? await this.deps.records.generationOf(generationId) : null;
    if (!generation || generation.tenantId !== member.tenantId) {
      throw new BackgroundAdoptionRefusal("NOT_FOUND", "画像生成が見つかりません");
    }
    if (!generation.succeeded || position > Math.min(generation.candidateCount, ImageGeneration.CANDIDATES_PER_GENERATION)) {
      throw new BackgroundAdoptionRefusal("NOT_ADOPTABLE", "この候補は背景写真にできません");
    }
    if (generation.style !== BACKGROUND_STYLE) {
      throw new BackgroundAdoptionRefusal("NOT_ADOPTABLE", "背景写真にできるのは背景・イラストの画像だけです（写真風の画像は使えません）");
    }
  }

  /** ⑤候補の画像が残っていること（片付け済みの候補は採用できない） */
  private async requireCandidateImage(member: RequestingMember, generationId: string, position: number): Promise<void> {
    const exists = await this.deps.images.candidateExists({ tenantId: member.tenantId, generationId, candidatePosition: position })
      .catch((e: unknown) => { throw this.storageFailure("候補の画像を確かめられなかった", e); });
    if (!exists) throw new BackgroundAdoptionRefusal("CANDIDATE_GONE", "候補の画像が残っていません。もう一度生成してください");
  }

  /** ⑥候補を背景写真の保存先に複製する（サーバーは画像を加工しない） */
  private copyCandidate(member: RequestingMember, generationId: string, position: number): Promise<string> {
    return this.deps.images.copyCandidate({ tenantId: member.tenantId, generationId, candidatePosition: position }, this.deps.newId())
      .catch((e: unknown) => { throw this.storageFailure("候補の画像を複製できなかった", e); });
  }

  /** ④同じ候補がすでに背景写真になっていれば、それを返す（200）。ただし「使わない」にした背景は、RPC と同じく採用できない */
  private alreadyAdopted(adoption: StoredAdoption): BackgroundAdoption {
    if (!adoption.usable) throw REFUSALS.NOT_ADOPTABLE;
    return { created: false, background: this.shown(adoption.photo) };
  }

  /**
   * ⑦記録する。⑧複製を消すのは、記録が確定して断られたとき（SQLSTATE が分かる拒否）だけ。
   * 結果が分からない失敗（接続の失敗・応答の消失・時間切れ）は、DB が記録済みかもしれないので、記録を読んで確かめる。
   * 記録した背景写真は読み直して返す
   */
  private async recordOrDiscard(
    member: RequestingMember, recording: { storagePath: string; generationId: string; candidatePosition: number; description: string },
  ): Promise<StoredBackgroundPhoto> {
    let photoId: string;
    try {
      photoId = await this.deps.records.record(member, recording);
    } catch (e) {
      if (e instanceof BackgroundRecordingRefused) {
        await this.discardCopy(recording.storagePath);
        throw REFUSALS[e.reason];
      }
      return await this.settleUnknownFailure(member, recording, e);
    }
    // 記録できたあとの読み直しの失敗では、複製を消さない（背景写真が参照している）
    const photo = await this.deps.records.photoOf(member.tenantId, photoId);
    if (!photo) throw new Error("記録した背景写真を読めませんでした");
    return photo;
  }

  /**
   * 記録の結果が分からないとき: 記録があれば成功として返す（複製は消さない。記録の保存先が自分の複製と違えば呼び出し側が消す）。
   * 記録が無ければ複製を消して元の失敗を返す。確かめる読み取りも失敗したら、複製は消さずに 502 にする
   * （孤児の画像より、参照先の無い背景写真の行のほうが害が大きい）
   */
  private async settleUnknownFailure(
    member: RequestingMember, recording: { storagePath: string; generationId: string; candidatePosition: number }, failure: unknown,
  ): Promise<StoredBackgroundPhoto> {
    const adoption = await this.deps.records.adoptionOf(member.tenantId, recording.generationId, recording.candidatePosition)
      .catch((e: unknown) => {
        warn("記録の結果を確かめられなかった", e);
        throw new BackgroundAdoptionRefusal("STORAGE_FAILED", "記録の結果を確かめられませんでした。時間を置いてもう一度お試しください");
      });
    if (adoption) return adoption.photo;
    await this.discardCopy(recording.storagePath);
    throw failure;
  }

  private discardCopy(storagePath: string): Promise<void> {
    return this.deps.images.remove(storagePath).catch((e: unknown) => warn("使われない背景の複製を消せなかった", e));
  }

  /** 同時に同じ候補を採用した相手が先に記録していたとき: 自分の複製は使われないので消し、先に作られた背景写真を返す */
  private async discardLostCopy(storagePath: string, photo: StoredBackgroundPhoto): Promise<BackgroundAdoption> {
    await this.discardCopy(storagePath);
    return { created: false, background: this.shown(photo) };
  }

  private shown(photo: StoredBackgroundPhoto): AdoptedBackground {
    return { photoId: photo.id, storagePath: photo.storagePath, description: photo.description };
  }

  private storageFailure(what: string, e: unknown): BackgroundAdoptionRefusal {
    warn(what, e);
    return new BackgroundAdoptionRefusal("STORAGE_FAILED", "画像の保存先でエラーが起きました。時間を置いてお試しください");
  }
}
