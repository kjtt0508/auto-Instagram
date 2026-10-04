import { InstagramConnecting } from "../../connection/application/instagramConnecting";
import { InstagramOAuthClient } from "../../connection/infrastructure/instagramOAuthClient";
import { SupabaseAdmin } from "../../connection/infrastructure/supabaseAdmin";
import { TokenCipher } from "../../connection/infrastructure/tokenCipher";
import { CandidateClearing } from "../../image/application/candidateClearing";
import { ImageGenerating } from "../../image/application/imageGenerating";
import { GeminiTranslator } from "../../image/infrastructure/geminiTranslator";
import { SupabaseImageRecords } from "../../image/infrastructure/supabaseImageRecords";
import { WorkersAiCandidateClient, type WorkersAiBinding } from "../../image/infrastructure/workersAiCandidateClient";
import { SupabaseService } from "./supabaseService";

// API関数のユースケースを、Cloudflare の環境変数（Secret）とバインディングから組み立てる
export type ApiEnv = {
  SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY: string; TOKEN_ENC_KEY_V1: string;
  IG_APP_ID: string; IG_APP_SECRET: string; IG_REDIRECT_URI: string; IG_API_VERSION: string;
  GEMINI_API_KEY: string; AI: WorkersAiBinding;
};

const KEY_VERSION = 1;
// Workers では fetch を別のオブジェクトのメソッドとして呼ぶと Illegal invocation になるため、関数で包んで渡す
const workersFetch: typeof fetch = (input, init) => fetch(input, init);

export function apiAssembly(http: typeof fetch = workersFetch, newId: () => string = () => crypto.randomUUID()) {
  const supabaseOf = (env: ApiEnv) => new SupabaseService({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY }, http);
  return {
    connecting: async (env: ApiEnv) => new InstagramConnecting({
      records: new SupabaseAdmin(supabaseOf(env)),
      instagram: new InstagramOAuthClient({ appId: env.IG_APP_ID, appSecret: env.IG_APP_SECRET,
        redirectUri: env.IG_REDIRECT_URI, apiVersion: env.IG_API_VERSION || "v23.0" }, http),
      sealing: await TokenCipher.fromBase64Key(env.TOKEN_ENC_KEY_V1, KEY_VERSION),
      now: () => new Date(),
    }),
    imageGenerating: async (env: ApiEnv) => new ImageGenerating({
      records: new SupabaseImageRecords(supabaseOf(env)),
      translator: new GeminiTranslator(env.GEMINI_API_KEY, http),
      images: new WorkersAiCandidateClient(env.AI),
      newId, now: () => Date.now(),
    }),
    candidateClearing: async (env: ApiEnv) => new CandidateClearing(new SupabaseImageRecords(supabaseOf(env))),
  };
}

export type ApiAssembly = ReturnType<typeof apiAssembly>;
