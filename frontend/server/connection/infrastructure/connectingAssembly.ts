import { InstagramConnecting } from "../application/instagramConnecting";
import { InstagramOAuthClient } from "./instagramOAuthClient";
import { SupabaseAdmin } from "./supabaseAdmin";
import { TokenCipher } from "./tokenCipher";

// 連携のユースケースを、Cloudflare の環境変数（Secret）から組み立てる
export type ApiEnv = {
  SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY: string; TOKEN_ENC_KEY_V1: string;
  IG_APP_ID: string; IG_APP_SECRET: string; IG_REDIRECT_URI: string; IG_API_VERSION: string;
};

const KEY_VERSION = 1;

export function connectingAssembly(http: typeof fetch = fetch) {
  return async (env: ApiEnv): Promise<InstagramConnecting> => new InstagramConnecting({
    records: new SupabaseAdmin({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY }, http),
    instagram: new InstagramOAuthClient({ appId: env.IG_APP_ID, appSecret: env.IG_APP_SECRET,
      redirectUri: env.IG_REDIRECT_URI, apiVersion: env.IG_API_VERSION || "v23.0" }, http),
    sealing: await TokenCipher.fromBase64Key(env.TOKEN_ENC_KEY_V1, KEY_VERSION),
    now: () => new Date(),
  });
}
