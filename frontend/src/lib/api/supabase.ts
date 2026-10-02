import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";

// ブラウザに出してよいのは URL と anon キーだけ（00_基本設計 6章）。読み書きの範囲は RLS と RPC が決める
let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY が設定されていません");
  client = createClient(url, anonKey, { auth: { flowType: "pkce", persistSession: true, detectSessionInUrl: true } });
  return client;
}

// RPC が返すエラーコード（V6__rls_rpc.sql）を、画面に出す文言にする
const MESSAGES: Record<string, string> = {
  "42501": "権限がありません",
  P0409: "他の人が先に操作しました。画面を更新してください",
};

/** Supabase のエラーを、画面に出せる文言の Error にする */
export function toUserError(error: PostgrestError | { message: string; code?: string }): Error {
  const code = "code" in error ? error.code : undefined;
  return new Error((code && MESSAGES[code]) ?? error.message);
}

/** 結果を取り出す。エラーか結果なしなら画面向けの文言で例外にする */
export function unwrap<T>(result: { data: T; error: PostgrestError | null }): NonNullable<T> {
  const data = unwrapOptional(result);
  if (data === null || data === undefined) throw new Error("データが見つかりません。画面を更新してください");
  return data;
}

/** 結果を取り出す（無いこともある: maybeSingle）。エラーなら例外 */
export function unwrapOptional<T>(result: { data: T; error: PostgrestError | null }): T {
  if (result.error) throw toUserError(result.error);
  return result.data;
}

/** 結果を返さない RPC の成否だけを確かめる */
export function check(result: { error: PostgrestError | null }): void {
  if (result.error) throw toUserError(result.error);
}
