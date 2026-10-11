import { ImageStyle } from "../../../src/domain/post/ImageStyle";
import { SupabaseRequestError, type SupabaseService } from "../../shared/infrastructure/supabaseService";
import {
  BackgroundRecordingRefused, type BackgroundAdoptionRecords, type BackgroundRecording, type RequestingMember,
  type StoredAdoption, type StoredBackgroundPhoto, type StoredImageGeneration,
} from "../application/backgroundAdoptionPorts";

// 画像生成・背景写真・背景写真としての採用の読み書き（service role。REQ-006 設計 4・5章、V11）
const eq = (value: string | number) => `eq.${encodeURIComponent(String(value))}`;

/** record_generated_background が返す SQLSTATE（文言は見ない。V11）から、拒否の理由への対応 */
const REFUSAL_BY_SQLSTATE: Record<string, BackgroundRecordingRefused["reason"]> = {
  P0409: "LIMIT_REACHED",     // 背景写真が30枚
  P0404: "NOT_FOUND",         // 団体・メンバーが無い
  "22023": "NOT_ADOPTABLE",   // 採用できない候補・写真風・説明文の形・保存先の重複・「使わない」になっている背景
  "42501": "STORAGE_PATH",    // 保存先の形（API が作るので通常は起きない）
};

type PhotoRow = { id: string; tenant_id: string; storage_path: string; description: string };

const stored = (row: PhotoRow): StoredBackgroundPhoto =>
  ({ id: row.id, tenantId: row.tenant_id, storagePath: row.storage_path, description: row.description });

export class SupabaseBackgroundRecords implements BackgroundAdoptionRecords {
  constructor(private readonly supabase: SupabaseService) {}

  memberOf(accessToken: string): Promise<RequestingMember | null> {
    return this.supabase.memberOf(accessToken);
  }

  async generationOf(generationId: string): Promise<StoredImageGeneration | null> {
    const [row] = await this.supabase.rest<{ tenant_id: string; style: string; outcome: string; candidate_count: number }[]>(
      `image_generations?select=tenant_id,style,outcome,candidate_count&id=${eq(generationId)}`);
    return row ? { tenantId: row.tenant_id, style: ImageStyle.from(row.style), succeeded: row.outcome === "SUCCEEDED", candidateCount: row.candidate_count } : null;
  }

  async adoptionOf(tenantId: string, generationId: string, candidatePosition: number): Promise<StoredAdoption | null> {
    // 「使わない」にした出来事（background_photo_retirements。写真ごとに0か1行）も一緒に読む
    const [row] = await this.supabase.rest<{ background_photos: (PhotoRow & { background_photo_retirements: unknown }) | null }[]>(
      `background_photo_adoptions?select=background_photos(id,tenant_id,storage_path,description,background_photo_retirements(background_photo_id))`
      + `&generation_id=${eq(generationId)}&candidate_position=${eq(candidatePosition)}`);
    const photo = row?.background_photos;
    if (!photo || photo.tenant_id !== tenantId) return null;
    const retirements = photo.background_photo_retirements;
    const retired = Array.isArray(retirements) ? retirements.length > 0 : retirements != null;
    return { photo: stored(photo), usable: !retired };
  }

  async photoOf(tenantId: string, photoId: string): Promise<StoredBackgroundPhoto | null> {
    const [row] = await this.supabase.rest<PhotoRow[]>(
      `background_photos?select=id,tenant_id,storage_path,description&id=${eq(photoId)}&tenant_id=${eq(tenantId)}`);
    return row ? stored(row) : null;
  }

  async record(member: RequestingMember, recording: BackgroundRecording): Promise<string> {
    try {
      return await this.supabase.rpc<string>("record_generated_background", {
        p_tenant: member.tenantId, p_member: member.memberId, p_storage_path: recording.storagePath,
        p_generation: recording.generationId, p_position: recording.candidatePosition, p_description: recording.description,
      });
    } catch (e) {
      const reason = e instanceof SupabaseRequestError && e.dbCode ? REFUSAL_BY_SQLSTATE[e.dbCode] : undefined;
      if (reason) throw new BackgroundRecordingRefused(reason, "背景写真にできませんでした");
      throw e;
    }
  }
}
