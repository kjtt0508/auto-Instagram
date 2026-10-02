"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertBanner } from "@/components/alert/AlertBanner";
import { japanYearMonth } from "@/components/format";
import { PostCalendar } from "@/components/post/PostCalendar";
import { StatusBadge } from "@/components/post/StatusBadge";
import { useSession } from "@/components/session/SessionGate";
import { Chevron, GroupedSection, LargeTitle, Placeholder } from "@/components/ui/Grouped";
import type { Alert } from "@/domain/alert/Alert";
import type { Post } from "@/domain/post/Post";
import { currentAlerts, postsAwaitingWork, postsInMonth } from "@/lib/api/homeQuery";

type HomeRecords = { alerts: { alert: Alert; href: string }[]; month: Post[]; awaiting: Post[] };

/** S-02 ホーム: 警告バナー／対応待ちの投稿／月の投稿カレンダー */
export default function HomePage() {
  const { member } = useSession();
  const [ym, setYm] = useState(() => japanYearMonth(new Date()));
  const [records, setRecords] = useState<HomeRecords | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    Promise.all([currentAlerts(new Date()), postsInMonth(ym.year, ym.month), postsAwaitingWork()])
      .then(([alerts, month, awaiting]) => setRecords({ alerts, month, awaiting }), (e: Error) => setError(e.message));
  }, [ym]);
  useEffect(load, [load]);

  return (
    <>
      <LargeTitle>ホーム</LargeTitle>
      {error && <Placeholder tone="error">{error}</Placeholder>}
      {!error && !records && <Placeholder>読み込み中…</Placeholder>}
      {records && (
        <>
          <AlertBanner alerts={records.alerts} />
          <AwaitingList posts={records.awaiting} />
          <MonthHeader ym={ym} onMove={(delta) => setYm(shiftMonth(ym, delta))} />
          <PostCalendar year={ym.year} month={ym.month} posts={records.month} role={member.role} onChanged={load} />
        </>
      )}
    </>
  );
}

const shiftMonth = (ym: { year: number; month: number }, delta: number) => {
  const index = ym.year * 12 + (ym.month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
};

function MonthHeader({ ym, onMove }: { ym: { year: number; month: number }; onMove: (delta: number) => void }) {
  return (
    <div className="mb-2 mt-6 flex items-center justify-between px-1">
      <h2 className="text-[22px] font-bold">{ym.year}年{ym.month}月</h2>
      <div className="flex">
        <button type="button" onClick={() => onMove(-1)} aria-label="前の月" className="h-11 w-11 text-[32px] leading-none text-tint active:opacity-60">‹</button>
        <button type="button" onClick={() => onMove(1)} aria-label="次の月" className="h-11 w-11 text-[32px] leading-none text-tint active:opacity-60">›</button>
      </div>
    </div>
  );
}

function AwaitingList({ posts }: { posts: readonly Post[] }) {
  if (posts.length === 0) return null;
  return (
    <GroupedSection title={`対応待ち（${posts.length}件）`} label="対応待ち">
      <ul>
        {posts.map((post) => (
          <li key={post.id} className="border-separator [&+&]:border-t">
            <Link href={`/posts/view/?id=${encodeURIComponent(post.id)}`} className="flex min-h-11 items-center gap-3 px-4 py-2.5 active:bg-fill">
              <span className="min-w-0 flex-1 truncate">{post.headline()}</span>
              <StatusBadge status={post.status} />
              <Chevron />
            </Link>
          </li>
        ))}
      </ul>
    </GroupedSection>
  );
}
