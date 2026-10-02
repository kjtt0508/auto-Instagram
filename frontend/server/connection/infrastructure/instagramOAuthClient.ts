import { AccessToken } from "../../../src/domain/connection/AccessToken";
import type { InstagramAccount, InstagramAuthorization } from "../application/instagramConnecting";

// Instagram ログイン方式の OAuth（02_外部連携設計 1.1。ADR-0003）。トークンは AccessToken に包み、ログ・レスポンスに出さない
const SCOPES = ["instagram_business_basic", "instagram_business_content_publish", "instagram_business_manage_insights"];

export type InstagramAppConfig = { appId: string; appSecret: string; redirectUri: string; apiVersion: string };

export class InstagramOAuthClient implements InstagramAuthorization {
  constructor(private readonly config: InstagramAppConfig, private readonly http: typeof fetch = fetch) {}

  authorizeUrl(state: string): string {
    const query = new URLSearchParams({ client_id: this.config.appId, redirect_uri: this.config.redirectUri,
      response_type: "code", scope: SCOPES.join(","), state });
    return `https://www.instagram.com/oauth/authorize?${query}`;
  }

  /** 認可コード → 短期トークン → 長期トークン（約60日） */
  async longLivedToken(code: string): Promise<{ token: AccessToken; expiresAt: (now: Date) => Date }> {
    const short = await this.json(await this.http("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      body: new URLSearchParams({ client_id: this.config.appId, client_secret: this.config.appSecret,
        grant_type: "authorization_code", redirect_uri: this.config.redirectUri, code }),
    }));
    const query = new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: this.config.appSecret,
      access_token: String(short.access_token) });
    const long = await this.json(await this.http(`https://graph.instagram.com/access_token?${query}`));
    const seconds = Number(long.expires_in);
    return { token: AccessToken.of(String(long.access_token)), expiresAt: (now) => new Date(now.getTime() + seconds * 1000) };
  }

  async account(token: AccessToken): Promise<InstagramAccount> {
    const query = new URLSearchParams({ fields: "user_id,username,account_type", access_token: token.reveal() });
    const me = await this.json(await this.http(`https://graph.instagram.com/${this.config.apiVersion}/me?${query}`));
    return { userId: String(me.user_id), username: String(me.username), accountType: String(me.account_type) };
  }

  /** エラーの本文はトークンを含みうるので、呼び出し元には状態コードだけを伝える */
  private async json(response: Response): Promise<Record<string, unknown>> {
    if (!response.ok) throw new Error(`Instagram API がエラーを返しました（${response.status}）`);
    return (await response.json()) as Record<string, unknown>;
  }
}
