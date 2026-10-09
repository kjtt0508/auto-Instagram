"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useSession } from "@/components/session/SessionGate";
import { LargeTitle, Placeholder } from "@/components/ui/Grouped";

/** 管理者の画面の枠: 「‹ 設定」の戻り、大きな題名。管理者でなければ中身を出さない（認可の正は RLS・RPC。画面は補助） */
export function AdminPage({ title, children }: { title: string; children: ReactNode }) {
  const { member } = useSession();
  return (
    <>
      <Link href="/settings/" className="-mx-1 inline-flex min-h-11 items-center px-1 text-[17px] text-tint active:opacity-60">‹ 設定</Link>
      <LargeTitle>{title}</LargeTitle>
      {member.role.canManageGeneration() ? children : <Placeholder>この画面は管理者だけが使えます</Placeholder>}
    </>
  );
}

/** 欄1つ: ラベル、入力、欄ごとの赤字の理由 */
export function FormField({ label, count, violations = [], hint, children }: {
  label: string; count?: string; violations?: readonly string[]; hint?: string; children: ReactNode;
}) {
  return (
    <div className="relative px-4 py-2.5 [&+&]:border-t [&+&]:border-separator">
      <div className="flex items-baseline justify-between gap-2 pb-1 text-[13px] text-secondary-label">
        <span>{label}</span>{count && <span>{count}</span>}
      </div>
      {children}
      {hint && <p className="pt-1 text-[13px] text-secondary-label">{hint}</p>}
      {violations.map((v) => <p key={v} data-violation={label} role="alert" className="pt-1 text-[13px] text-destructive">{v}</p>)}
    </div>
  );
}

export const FORM_INPUT = "block w-full rounded-[8px] bg-fill px-3 py-2 text-[17px] outline-none";
