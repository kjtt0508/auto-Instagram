import { CONNECTING_FAILURE_MESSAGES, type ConnectingFailureReason } from "./instagramConnectingReasons";
import { check, supabase } from "./supabase";

// Instagram と連携する（02_外部連携設計 1.1）。OAuth は API関数が行い、画面はトークンに触れない（AC-001-03）

/** 連携を始める: API関数から認可 URL をもらい、Instagram へ移動する */
export async function startConnecting(): Promise<void> {
  const { data } = await supabase().auth.getSession();
  const response = await fetch("/api/instagram/connect", {
    method: "POST",
    headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message ?? "連携を始められませんでした");
  window.location.assign(body.authorizeUrl);
}

export async function disconnect(): Promise<void> {
  check(await supabase().rpc("disconnect_instagram"));
}

/** コールバック後に設定画面へ戻ったときの結果（/settings/?instagram=connected|error&reason=…） */
export function connectingResult(params: URLSearchParams): { ok: boolean; message: string } | null {
  const result = params.get("instagram");
  if (result === "connected") return { ok: true, message: "Instagramと連携しました" };
  if (result !== "error") return null;
  const reason = params.get("reason") ?? "";
  const message = reason in CONNECTING_FAILURE_MESSAGES
    ? CONNECTING_FAILURE_MESSAGES[reason as ConnectingFailureReason] : CONNECTING_FAILURE_MESSAGES.failed;
  return { ok: false, message };
}
