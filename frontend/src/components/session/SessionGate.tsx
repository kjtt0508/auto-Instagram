"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Member } from "@/domain/member/Member";
import type { Tenant } from "@/domain/tenant/Tenant";
import { currentSession, signInWithGoogle, signOut, type SessionState } from "@/lib/api/memberSession";
import { supabase } from "@/lib/api/supabase";
import { Button } from "@/components/ui/Button";
import { Placeholder } from "@/components/ui/Grouped";

const SessionContext = createContext<{ member: Member; tenant: Tenant } | null>(null);

/** ログイン中のメンバーと団体（SessionGate の内側でだけ使える） */
export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error("SessionGate の外では使えません");
  return session;
}

/** S-01 ログイン: 許可リストのメンバーだけが中の画面を見られる（AC-001-01, 02） */
export function SessionGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState | "loading" | Error>("loading");
  useEffect(() => {
    const refresh = () => currentSession().then(setState, (e: Error) => setState(e));
    refresh();
    // ログイン・ログアウトで入れ替える（トークンの自動更新では読み直さない）
    const { data } = supabase().auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") setTimeout(refresh, 0);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  if (state === "loading") return <Placeholder>読み込み中…</Placeholder>;
  if (state instanceof Error) return <Placeholder tone="error">{state.message}</Placeholder>;
  if (state.kind === "signedOut") return <LoginScreen />;
  if (state.kind === "forbidden") return <ForbiddenScreen email={state.email} />;
  return <SessionContext.Provider value={{ member: state.member, tenant: state.tenant }}>{children}</SessionContext.Provider>;
}

function LoginScreen() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-between px-6 pb-12 pt-[20vh]">
      <div className="text-center">
        <h1 className="text-[34px] font-bold tracking-tight">新島info 投稿</h1>
        <p className="pt-2 text-[17px] text-secondary-label">Instagram の予約投稿を管理します</p>
      </div>
      <Button variant="filled" block onClick={() => signInWithGoogle()}>Googleでログイン</Button>
    </main>
  );
}

function ForbiddenScreen({ email }: { email: string }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-between px-6 pb-12 pt-[20vh] text-center">
      <div>
        <p role="alert" className="text-[22px] font-bold">利用が許可されていません</p>
        <p className="pt-2 text-[15px] text-secondary-label">管理者に連絡してください<br />{email}</p>
      </div>
      <Button variant="tinted" block onClick={() => signOut()}>別のアカウントでログイン</Button>
    </main>
  );
}
