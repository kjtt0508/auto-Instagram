import { candidatePath } from "../../image/infrastructure/supabaseImageRecords";
import type { SupabaseService } from "../../shared/infrastructure/supabaseService";
import type { BackgroundImageStore, CandidateLocation } from "../application/backgroundAdoptionPorts";

const pathOf = (c: CandidateLocation) => candidatePath(c.tenantId, c.generationId, c.candidatePosition);

// 候補の画像の存在確認と、背景写真の保存先への複製（service role。REQ-006 設計 4章）。
// 背景写真の保存先は {団体}/backgrounds/{ファイル名}.jpg（register_background_photo・record_generated_background が検査する形）

export class SupabaseBackgroundImages implements BackgroundImageStore {
  constructor(private readonly supabase: SupabaseService) {}

  candidateExists(candidate: CandidateLocation): Promise<boolean> {
    return this.supabase.existsPrivate(pathOf(candidate));
  }

  async copyCandidate(candidate: CandidateLocation, fileId: string): Promise<string> {
    const to = `${candidate.tenantId}/backgrounds/${fileId}.jpg`;
    await this.supabase.copyPrivate(pathOf(candidate), to);
    return to;
  }

  remove(storagePath: string): Promise<void> {
    return this.supabase.deletePrivate([storagePath]);
  }
}
