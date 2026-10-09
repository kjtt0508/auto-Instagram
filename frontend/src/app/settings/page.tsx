"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useSession } from "@/components/session/SessionGate";
import { ConnectionSection } from "@/components/settings/ConnectionSection";
import { GenerationAdminSection } from "@/components/settings/GenerationAdminSection";
import { MemberSection } from "@/components/settings/MemberSection";
import { CellButton } from "@/components/ui/Button";
import { GroupedSection, LargeTitle } from "@/components/ui/Grouped";
import { connectingResult } from "@/lib/api/instagramConnecting";
import { signOut } from "@/lib/api/memberSession";

/** S-11 設定: ① Instagram 連携 ② メンバー ③ 下書きの生成（管理者だけ） */
export default function SettingsPage() {
  const { member } = useSession();
  return (
    <>
      <LargeTitle>設定</LargeTitle>
      <Suspense fallback={null}><ConnectingResult /></Suspense>
      <ConnectionSection role={member.role} />
      <MemberSection me={member} />
      {member.role.canManageGeneration() && <GenerationAdminSection />}
      <GroupedSection title="アカウント" footer={`${member.displayName}（${member.role.label}）でログイン中`}>
        <CellButton variant="destructive" onClick={() => signOut()}>ログアウト</CellButton>
      </GroupedSection>
    </>
  );
}

function ConnectingResult() {
  const result = connectingResult(useSearchParams());
  if (!result) return null;
  return (
    <p role="status" className={`mt-2 rounded-cell bg-cell px-4 py-3 text-[15px] ${result.ok ? "text-success" : "text-destructive"}`}>{result.message}</p>
  );
}
