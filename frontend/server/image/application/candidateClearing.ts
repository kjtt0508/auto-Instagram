import { ImageGeneration } from "../../../src/domain/image/ImageGeneration";
import { ImageGenerationRefusal, type ImageGenerationRecords } from "./imageGenerationPorts";

// 候補を片付ける（REQ-005 BR-005-11）。採用の操作を終えた・閉じたときに、その画像生成の候補の画像を消す。何度呼んでもよい
export class CandidateClearing {
  constructor(private readonly records: ImageGenerationRecords) {}

  async clear(accessToken: string, generationId: string): Promise<void> {
    const member = await this.records.memberOf(accessToken);
    if (!member) throw new ImageGenerationRefusal("FORBIDDEN", "利用が許可されていません");
    const tenantId = await this.records.tenantOfGeneration(generationId);
    if (!tenantId) throw new ImageGenerationRefusal("NOT_FOUND", "画像生成が見つかりません");
    if (tenantId !== member.tenantId) throw new ImageGenerationRefusal("FORBIDDEN", "ほかの団体の画像生成です");
    const positions = Array.from({ length: ImageGeneration.CANDIDATES_PER_GENERATION }, (_, i) => i + 1);
    await this.records.clearCandidates(tenantId, generationId, positions);
  }
}
