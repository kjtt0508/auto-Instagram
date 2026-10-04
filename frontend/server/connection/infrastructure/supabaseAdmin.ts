import type { SupabaseService } from "../../shared/infrastructure/supabaseService";
import type { ConnectingMember, ConnectingRecords, InstagramAccount, SealedToken } from "../application/instagramConnecting";

// Instagram 連携の記録（service role）。Supabase の呼び出しは共通の SupabaseService に任せる
export class SupabaseAdmin implements ConnectingRecords {
  constructor(private readonly supabase: SupabaseService) {}

  memberOf(accessToken: string): Promise<ConnectingMember | null> {
    return this.supabase.memberOf(accessToken);
  }

  async saveOAuthState(state: string, member: ConnectingMember, expiresAt: Date): Promise<void> {
    await this.supabase.rest("oauth_states", { method: "POST", body: JSON.stringify(
      { state, tenant_id: member.tenantId, member_id: member.memberId, expires_at: expiresAt.toISOString() }) });
  }

  /** state を使い捨てにする（取り出して削除）。無ければ null */
  async consumeOAuthState(state: string): Promise<{ tenantId: string; memberId: string; expiresAt: Date } | null> {
    const rows = await this.supabase.rest<{ tenant_id: string; member_id: string; expires_at: string }[]>(
      `oauth_states?state=eq.${encodeURIComponent(state)}`, { method: "DELETE", headers: { Prefer: "return=representation" } });
    return rows[0] ? { tenantId: rows[0].tenant_id, memberId: rows[0].member_id, expiresAt: new Date(rows[0].expires_at) } : null;
  }

  async recordConnection(record: {
    connectionId: string; tenantId: string; memberId: string; account: InstagramAccount; sealed: SealedToken; expiresAt: Date;
  }): Promise<void> {
    await this.supabase.rpc("record_instagram_connection", {
      p_connection: record.connectionId, p_tenant: record.tenantId, p_member: record.memberId, p_ig_user_id: record.account.userId,
      p_ig_username: record.account.username, p_account_type: record.account.accountType,
      p_token_ciphertext: record.sealed.ciphertextBase64, p_token_iv: record.sealed.ivBase64,
      p_key_version: record.sealed.keyVersion, p_expires_at: record.expiresAt.toISOString(),
    });
  }
}
