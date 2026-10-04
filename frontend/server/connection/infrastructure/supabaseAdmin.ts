import type { ConnectingMember, ConnectingRecords, InstagramAccount, SealedToken } from "../application/instagramConnecting";

// API関数から Supabase を service role で読み書きする（RLS を通らないので、呼ぶ前に権限を確かめる）
export type AdminConfig = { url: string; serviceRoleKey: string };

export class SupabaseAdmin implements ConnectingRecords {
  constructor(private readonly config: AdminConfig, private readonly http: typeof fetch = (input, init) => fetch(input, init)) {}

  /** 画面から来たアクセストークン（JWT）の持ち主の、有効なメンバー。いなければ null */
  async memberOf(accessToken: string): Promise<ConnectingMember | null> {
    const user = await this.http(`${this.config.url}/auth/v1/user`, {
      headers: { apikey: this.config.serviceRoleKey, Authorization: `Bearer ${accessToken}` },
    });
    if (!user.ok) return null;
    const { id } = (await user.json()) as { id: string };
    const rows = await this.rest<{ member_id: string; tenant_id: string; role: string }[]>(
      `member_current?select=member_id,tenant_id,role&active=is.true&auth_user_id=eq.${encodeURIComponent(id)}`);
    return rows[0] ? { memberId: rows[0].member_id, tenantId: rows[0].tenant_id, roleCode: rows[0].role } : null;
  }

  async saveOAuthState(state: string, member: ConnectingMember, expiresAt: Date): Promise<void> {
    await this.rest("oauth_states", { method: "POST", body: JSON.stringify(
      { state, tenant_id: member.tenantId, member_id: member.memberId, expires_at: expiresAt.toISOString() }) });
  }

  /** state を使い捨てにする（取り出して削除）。無ければ null */
  async consumeOAuthState(state: string): Promise<{ tenantId: string; memberId: string; expiresAt: Date } | null> {
    const rows = await this.rest<{ tenant_id: string; member_id: string; expires_at: string }[]>(
      `oauth_states?state=eq.${encodeURIComponent(state)}`, { method: "DELETE", headers: { Prefer: "return=representation" } });
    return rows[0] ? { tenantId: rows[0].tenant_id, memberId: rows[0].member_id, expiresAt: new Date(rows[0].expires_at) } : null;
  }

  async recordConnection(record: {
    connectionId: string; tenantId: string; memberId: string; account: InstagramAccount; sealed: SealedToken; expiresAt: Date;
  }): Promise<void> {
    await this.rest("rpc/record_instagram_connection", { method: "POST", body: JSON.stringify({
      p_connection: record.connectionId, p_tenant: record.tenantId, p_member: record.memberId, p_ig_user_id: record.account.userId,
      p_ig_username: record.account.username, p_account_type: record.account.accountType,
      p_token_ciphertext: record.sealed.ciphertextBase64,
      p_token_iv: record.sealed.ivBase64, p_key_version: record.sealed.keyVersion, p_expires_at: record.expiresAt.toISOString(),
    }) });
  }

  private async rest<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.http(`${this.config.url}/rest/v1/${path}`, { ...init, headers: {
      apikey: this.config.serviceRoleKey, Authorization: `Bearer ${this.config.serviceRoleKey}`,
      "Content-Type": "application/json", ...init.headers } });
    if (!response.ok) throw new Error(`Supabase がエラーを返しました（${response.status}）`);
    const text = await response.text();
    return (text ? JSON.parse(text) : null) as T;
  }
}
