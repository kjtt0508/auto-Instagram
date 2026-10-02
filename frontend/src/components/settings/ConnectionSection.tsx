"use client";

import { useEffect, useState } from "react";
import { formatDateTime } from "@/components/format";
import { CellButton } from "@/components/ui/Button";
import { GroupedSection, ValueCell } from "@/components/ui/Grouped";
import type { InstagramConnection } from "@/domain/connection/InstagramConnection";
import type { Role } from "@/domain/member/Role";
import { connectionStatus } from "@/lib/api/homeQuery";
import { disconnect, startConnecting } from "@/lib/api/instagramConnecting";

/** S-11 ① Instagram 連携: ユーザー名と有効期限（トークンは出さない。AC-001-03）。操作は管理者だけ */
export function ConnectionSection({ role }: { role: Role }) {
  const [connection, setConnection] = useState<InstagramConnection | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const load = () => connectionStatus().then(setConnection, (e: Error) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  const act = (command: () => Promise<void>) => command().then(load, (e: Error) => setError(e.message));
  const footer = error ? <span role="alert" className="text-destructive">{error}</span>
    : !role.canManageConnection() && "連携の操作は管理者だけができます";

  return (
    <GroupedSection title="Instagram連携" footer={footer || undefined}>
      {connection === undefined && <ValueCell label="状態">読み込み中…</ValueCell>}
      {connection === null && <ValueCell label="状態">連携していません</ValueCell>}
      {connection && <ConnectionStatus connection={connection} />}
      {role.canManageConnection() && (
        <div className="border-t border-separator">
          <CellButton onClick={() => act(startConnecting)}>{connection ? "連携し直す" : "Instagramと連携"}</CellButton>
        </div>
      )}
      {role.canManageConnection() && connection && (
        <div className="border-t border-separator"><CellButton variant="destructive" onClick={() => act(disconnect)}>連携を解除</CellButton></div>
      )}
    </GroupedSection>
  );
}

function ConnectionStatus({ connection }: { connection: InstagramConnection }) {
  const now = new Date();
  const warn = connection.needsAttention(now);
  return (
    <>
      <ValueCell label="アカウント">@{connection.igUsername}</ValueCell>
      <ValueCell label="有効期限">
        <span className={warn ? "font-semibold text-destructive" : undefined}>
          {formatDateTime(connection.tokenExpiry.toDate())}（残り{connection.remainingDays(now)}日）
        </span>
      </ValueCell>
      {connection.refreshFailed() && <ValueCell label="更新"><span className="text-destructive">失敗しています</span></ValueCell>}
    </>
  );
}
