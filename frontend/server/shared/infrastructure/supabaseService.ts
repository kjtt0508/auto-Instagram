// API関数から Supabase を service role で読み書きする共通の部品（RLS を通らないので、呼ぶ前に権限を確かめる）
// 例外の文言は状態コードだけにする（本文に秘密が含まれうるため。ログに出しても安全）
export type SupabaseConfig = { url: string; serviceRoleKey: string };
export type ServiceMember = { memberId: string; tenantId: string; roleCode: string };

const BUCKET = "uploads-private";

export class SupabaseService {
  constructor(private readonly config: SupabaseConfig, private readonly http: typeof fetch = (input, init) => fetch(input, init)) {}

  /** 画面から来たアクセストークン（JWT）の持ち主の、有効なメンバー。いなければ null */
  async memberOf(accessToken: string): Promise<ServiceMember | null> {
    const user = await this.http(`${this.config.url}/auth/v1/user`, {
      headers: { apikey: this.config.serviceRoleKey, Authorization: `Bearer ${accessToken}` },
    });
    if (!user.ok) {
      // 鍵の値は出さない。設定の取り違えに気づけるよう、接続先のホスト・鍵の種類と長さ・Supabase の文言だけを出す
      const reason = ((await user.json().catch(() => ({}))) as { msg?: string; message?: string });
      console.warn(`メンバーの確認: アクセストークンを確かめられません（auth ${user.status} ${reason.msg ?? reason.message ?? ""}）`
        + ` host=${new URL(this.config.url).host} key=${this.keyKind()}`);
      return null;
    }
    const { id } = (await user.json()) as { id: string };
    const rows = await this.rest<{ member_id: string; tenant_id: string; role: string }[]>(
      `member_current?select=member_id,tenant_id,role&active=is.true&auth_user_id=eq.${encodeURIComponent(id)}`);
    if (!rows[0]) console.warn("メンバーの確認: ログインした利用者に、有効なメンバーが結び付いていません");
    return rows[0] ? { memberId: rows[0].member_id, tenantId: rows[0].tenant_id, roleCode: rows[0].role } : null;
  }

  async rest<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.http(`${this.config.url}/rest/v1/${path}`, { ...init, headers: {
      ...this.authHeaders(), "Content-Type": "application/json", ...init.headers } });
    if (!response.ok) throw new Error(`Supabase がエラーを返しました（${response.status}）`);
    const text = await response.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    return this.rest<T>(`rpc/${name}`, { method: "POST", body: JSON.stringify(args) });
  }

  /** 非公開バケットに保存し、期限付き URL を返す */
  async uploadPrivate(path: string, bytes: Uint8Array, contentType: string, signedSeconds: number): Promise<string> {
    const uploaded = await this.http(`${this.config.url}/storage/v1/object/${BUCKET}/${path}`, {
      method: "POST", body: bytes as BodyInit, headers: { ...this.authHeaders(), "Content-Type": contentType, "x-upsert": "true" } });
    if (!uploaded.ok) throw new Error(`Storage への保存に失敗しました（${uploaded.status}）`);
    const signed = await this.http(`${this.config.url}/storage/v1/object/sign/${BUCKET}/${path}`, {
      method: "POST", body: JSON.stringify({ expiresIn: signedSeconds }), headers: { ...this.authHeaders(), "Content-Type": "application/json" } });
    if (!signed.ok) throw new Error(`期限付き URL を作れませんでした（${signed.status}）`);
    const { signedURL } = (await signed.json()) as { signedURL: string };
    return `${this.config.url}/storage/v1${signedURL}`;
  }

  async deletePrivate(paths: readonly string[]): Promise<void> {
    const response = await this.http(`${this.config.url}/storage/v1/object/${BUCKET}`, {
      method: "DELETE", body: JSON.stringify({ prefixes: paths }), headers: { ...this.authHeaders(), "Content-Type": "application/json" } });
    if (!response.ok) throw new Error(`Storage からの削除に失敗しました（${response.status}）`);
  }

  /** 鍵の種類と長さ（値そのものは出さない） */
  private keyKind(): string {
    const key = this.config.serviceRoleKey;
    const kind = key.startsWith("sb_secret_") ? "sb_secret" : key.startsWith("eyJ") ? "jwt" : "unknown";
    return `${kind}/${key.length}${key.trim() !== key ? "/空白あり" : ""}`;
  }

  private authHeaders(): Record<string, string> {
    return { apikey: this.config.serviceRoleKey, Authorization: `Bearer ${this.config.serviceRoleKey}` };
  }
}
