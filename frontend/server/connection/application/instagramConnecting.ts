import type { AccessToken } from "../../../src/domain/connection/AccessToken";
import { InstagramConnection } from "../../../src/domain/connection/InstagramConnection";
import { Role } from "../../../src/domain/member/Role";
import type { ConnectingFailureReason } from "../../../src/lib/api/instagramConnectingReasons";

// Instagram と連携する（REQ-001 設計 1章 InstagramConnecting.start / complete）。手順だけを並べ、判断はドメインに問う
// 外部（Supabase・Instagram・暗号化）はここで定めたインターフェースを通して使う。実装は infrastructure（P16）
const STATE_TTL_MS = 10 * 60 * 1000;

export type ConnectingMember = { memberId: string; tenantId: string; roleCode: string };
export type SealedToken = { ciphertextBase64: string; ivBase64: string; keyVersion: number };
export type InstagramAccount = { userId: string; username: string; accountType: string };

/** 連携の記録（service role で読み書きする） */
export interface ConnectingRecords {
  memberOf(accessToken: string): Promise<ConnectingMember | null>;
  saveOAuthState(state: string, member: ConnectingMember, expiresAt: Date): Promise<void>;
  consumeOAuthState(state: string): Promise<{ tenantId: string; memberId: string; expiresAt: Date } | null>;
  recordConnection(record: {
    connectionId: string; tenantId: string; memberId: string; account: InstagramAccount; sealed: SealedToken; expiresAt: Date;
  }): Promise<void>;
}

/** Instagram の OAuth */
export interface InstagramAuthorization {
  authorizeUrl(state: string): string;
  longLivedToken(code: string): Promise<{ token: AccessToken; expiresAt: (now: Date) => Date }>;
  account(token: AccessToken): Promise<InstagramAccount>;
}

/** アクセストークンの暗号化（ADR-0007） */
export interface TokenSealing {
  seal(token: AccessToken, connectionId: string): Promise<SealedToken>;
}

/** 連携を始められない（認証なし・管理者でない） */
export class ConnectingForbiddenError extends Error {}

/** コールバックの結果。reason は設定画面に戻すときの理由（画面と同じ定義を使う） */
export type ConnectingOutcome = { ok: true } | { ok: false; reason: ConnectingFailureReason };

export class InstagramConnecting {
  constructor(private readonly deps: {
    records: ConnectingRecords; instagram: InstagramAuthorization; sealing: TokenSealing; now: () => Date;
  }) {}

  /** 管理者だけが連携を始められる。使い捨ての state を保存し、認可 URL を返す */
  async start(accessToken: string): Promise<string> {
    const member = await this.deps.records.memberOf(accessToken);
    if (!member || !Role.from(member.roleCode).canManageConnection()) throw new ConnectingForbiddenError("管理者だけが連携できます");
    const state = randomState();
    await this.deps.records.saveOAuthState(state, member, new Date(this.deps.now().getTime() + STATE_TTL_MS));
    return this.deps.instagram.authorizeUrl(state);
  }

  /** Instagram から戻ってきたら、state を確かめてトークンを暗号化して記録する */
  async complete(params: { code: string | null; state: string | null; error: string | null }): Promise<ConnectingOutcome> {
    if (params.error || !params.code) return { ok: false, reason: "access_denied" };
    const issued = params.state ? await this.deps.records.consumeOAuthState(params.state) : null;
    if (!issued || issued.expiresAt.getTime() < this.deps.now().getTime()) return { ok: false, reason: "state" };
    const { token, expiresAt } = await this.deps.instagram.longLivedToken(params.code);
    const account = await this.deps.instagram.account(token);
    if (!InstagramConnection.acceptsAccountType(account.accountType)) return { ok: false, reason: "account_type" };
    const connectionId = crypto.randomUUID();
    await this.deps.records.recordConnection({
      connectionId, tenantId: issued.tenantId, memberId: issued.memberId, account,
      sealed: await this.deps.sealing.seal(token, connectionId), expiresAt: expiresAt(this.deps.now()),
    });
    return { ok: true };
  }
}

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
