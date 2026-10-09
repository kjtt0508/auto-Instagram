import { GenerationInput } from "../../../src/domain/draft/GenerationInput";
import { GenerationRoute } from "../../../src/domain/draft/GenerationRoute";
import { Idea } from "../../../src/domain/draft/Idea";
import { PromptPurpose } from "../../../src/domain/draft/PromptPurpose";
import { RevisionInstruction } from "../../../src/domain/draft/RevisionInstruction";
import { checkDraftOutput, readCurrentDraft, type CurrentDraft } from "./draftOutputChecking";
import { DraftRefusal, type DraftRecords, type RequestingMember } from "./draftPorts";
import {
  japanDate, loadContext, requireMember, requireOwnGeneration, requireOwnIdea, requireOwnPromptVersion, type DraftContext, type DraftResult,
} from "./draftSupport";

// 手動コピペ（REQ-002 設計 1・4章）: 上限・障害のときに、外部のAIに貼るプロンプトを渡し、返ってきた JSON を取り込む。
// LLM利用回数は数えない（生成経路 MANUAL）

type PromptRequest = { ideaId?: unknown; ideaText?: unknown; instruction?: unknown; current?: unknown };
type ImportRequest = { ideaId?: unknown; promptVersionId?: unknown; json?: unknown;
  /** 修正（REVISE）のプロンプトを使ったときだけ: 親の生成・修正指示・現在の下書き */
  parentGenerationId?: unknown; instruction?: unknown; current?: unknown };

type Revision = { instruction: RevisionInstruction; draft: CurrentDraft["draft"]; keep: CurrentDraft["keep"] };

export class ManualRelay {
  constructor(private readonly deps: { records: DraftRecords; newId: () => string; now: () => number }) {}

  /** 手動コピペ用のプロンプトを得る。ネタは ideaId があれば再利用し、無ければ ideaText を記録する（更新のユースケース） */
  async prompt(accessToken: string, request: PromptRequest): Promise<{ ideaId: string; promptVersionId: string; prompt: string }> {
    const member = await requireMember(this.deps.records, accessToken);
    const revising = request.instruction !== undefined || request.current !== undefined;
    const purpose = revising ? PromptPurpose.REVISE : PromptPurpose.PLAN;
    const revision = revising ? this.revisionOf(request.instruction, request.current) : undefined;
    const context = await loadContext(this.deps.records, member, purpose);
    const idea = request.ideaId !== undefined ? await requireOwnIdea(this.deps.records, member, request.ideaId)
      : await this.recordNewIdea(member, request.ideaText);
    const input = this.inputOf(idea.text, context, revision);
    return { ideaId: idea.id, promptVersionId: context.prompt.id, prompt: context.prompt.render(input) };
  }

  /** 貼り付けられた JSON を取り込む。下書き案と同じ検査に通ったものだけを、生成経路 MANUAL で記録する */
  async import(accessToken: string, request: ImportRequest): Promise<DraftResult> {
    const started = this.deps.now();
    const member = await requireMember(this.deps.records, accessToken);
    const idea = await requireOwnIdea(this.deps.records, member, request.ideaId);
    const version = await requireOwnPromptVersion(this.deps.records, member, request.promptVersionId);
    const purpose = version.purpose;
    if (!purpose.acceptsManualImport()) {
      throw new DraftRefusal("INVALID_REQUEST", `${purpose.label}のプロンプトは取り込めません`);
    }
    const parentId = purpose.keepsCurrentDraftTraits() ? await this.requireParent(member, request, idea.id) : undefined;
    const revision = parentId ? this.revisionOf(request.instruction, request.current) : undefined;
    const context = await loadContext(this.deps.records, member, purpose);
    // 記録する入力は、取り込んだ時点で組み立て直したもの（貼ったプロンプトを作ったときの入力とは、日付やプロンプトの候補が違うことがある）
    const input = this.inputOf(idea.text, context, revision, japanDate(started));
    const text = typeof request.json === "string" ? request.json : JSON.stringify(request.json ?? null);
    const checked = checkDraftOutput(text, { style: context.style, prLabel: context.settings.prLabel, purpose,
      backgroundPhotoIds: context.photos.map((p) => p.id), keep: revision?.keep });
    if (!checked.proposal) throw new DraftRefusal("INVALID_MANUAL_OUTPUT", "取り込めません。直す点を確かめてください", checked.violations, idea.id);
    const generationId = this.deps.newId();
    const json = checked.proposal.toJson();
    // 手動コピペ（MANUAL）は LLM利用回数を確保しない（GenerationRoute.countsLlmUsage が false）ので、usage は無い
    const route = GenerationRoute.MANUAL;
    await this.deps.records.recordGeneration({ id: generationId, member, purpose, route, ideaId: idea.id,
      promptVersionId: version.id, input, outcome: "SUCCEEDED", attempts: [], result: json,
      revision: parentId && revision ? { parentGenerationId: parentId, instruction: revision.instruction.text } : undefined });
    return { generationId, ideaId: idea.id, proposal: json, unsupportedFacts: checked.proposal.unsupportedFacts(idea.text), usage: null,
      ...(parentId ? { parentGenerationId: parentId } : {}) };
  }

  private inputOf(ideaText: string, context: DraftContext, revision: Revision | undefined, today = japanDate(this.deps.now())): GenerationInput {
    const coverTargets = context.style.coverTargets();
    return revision
      ? GenerationInput.forRevision({ ideaText, today, coverTargets, instruction: revision.instruction, currentDraft: revision.draft,
        bodySlideCount: revision.keep.bodySlideCount })
      : GenerationInput.forPlan({ ideaText, today, coverTargets, backgroundPhotos: context.photos });
  }

  private async recordNewIdea(member: RequestingMember, ideaText: unknown): Promise<{ id: string; text: string }> {
    const text = typeof ideaText === "string" ? ideaText : "";
    const violations = Idea.violationsOf(text);
    if (violations.length > 0) throw new DraftRefusal("INVALID_IDEA", violations[0], violations);
    const idea = Idea.memo({ id: this.deps.newId(), text });
    await this.deps.records.recordIdea(member, idea.id, idea.text);
    return idea;
  }

  /** 取り込み: 親の生成が自団体のもので、そのネタの続きであること */
  private async requireParent(member: RequestingMember, request: ImportRequest, ideaId: string): Promise<string> {
    if (request.parentGenerationId === undefined) throw new DraftRefusal("INVALID_REQUEST", "修正の取り込みには元の生成（parentGenerationId）が必要です");
    const parent = await requireOwnGeneration(this.deps.records, member, request.parentGenerationId);
    // 比べるのは、記録から読んだネタのID（クライアントが送った文字列とは比べない）
    if (parent.ideaId !== ideaId) throw new DraftRefusal("INVALID_REQUEST", "元の生成とネタが違います");
    return parent.id;
  }

  private revisionOf(instruction: unknown, current: unknown): Revision {
    const text = typeof instruction === "string" ? instruction : "";
    const violations = RevisionInstruction.violationsOf(text);
    if (violations.length > 0) throw new DraftRefusal("INVALID_REQUEST", violations[0], violations);
    const read = readCurrentDraft(current);
    if (!read.ok) throw new DraftRefusal("INVALID_REQUEST", read.errors[0], read.errors);
    return { instruction: RevisionInstruction.of(text), draft: read.draft, keep: read.keep };
  }
}
