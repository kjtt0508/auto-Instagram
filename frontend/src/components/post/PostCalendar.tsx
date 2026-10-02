"use client";

import Link from "next/link";
import { formatDateTime, japanDateKey } from "@/components/format";
import { Chevron } from "@/components/ui/Grouped";
import type { Role } from "@/domain/member/Role";
import type { Post } from "@/domain/post/Post";
import { RetryForm } from "./RetryForm";
import { StatusBadge, statusDotClass } from "./StatusBadge";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** 投稿カレンダー（S-02）: 日ごとに状態色の印を付け、下に日付順の一覧。失敗は理由と再実行（AC-001-22） */
export function PostCalendar({ year, month, posts, role, onChanged }: {
  year: number; month: number; posts: readonly Post[]; role: Role; onChanged: () => void;
}) {
  const byDay = groupByDay(posts);
  const ordered = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).flatMap(([, dayPosts]) => dayPosts);
  return (
    <section aria-label="投稿カレンダー">
      <MonthGrid year={year} month={month} byDay={byDay} />
      {ordered.length > 0 && (
        <ol className="mt-4 overflow-hidden rounded-cell bg-cell">
          {ordered.map((post) => <li key={post.id} className="border-separator [&+&]:border-t"><CalendarEntry post={post} role={role} onChanged={onChanged} /></li>)}
        </ol>
      )}
      {ordered.length === 0 && <p className="px-4 pt-3 text-[13px] text-secondary-label">この月の予約・公開はありません</p>}
    </section>
  );
}

function groupByDay(posts: readonly Post[]): Map<string, Post[]> {
  const byDay = new Map<string, Post[]>();
  for (const post of posts) {
    const date = post.calendarDate();
    if (!date) continue;
    const key = japanDateKey(date);
    byDay.set(key, [...(byDay.get(key) ?? []), post].sort((a, b) => a.calendarDate()!.getTime() - b.calendarDate()!.getTime()));
  }
  return byDay;
}

function MonthGrid({ year, month, byDay }: { year: number; month: number; byDay: Map<string, Post[]> }) {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const today = japanDateKey(new Date());
  const cells = [...Array(firstWeekday).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  return (
    <div className="grid grid-cols-7 rounded-cell bg-cell px-1 pb-2 pt-1 text-center">
      {WEEKDAYS.map((w) => <div key={w} className="py-1 text-[11px] font-semibold text-secondary-label">{w}</div>)}
      {cells.map((day, i) => {
        const key = day ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : `blank-${i}`;
        return (
          <div key={key} className="flex h-11 flex-col items-center gap-0.5" data-date={day ? key : undefined}>
            {day && (
              <span className={`flex h-7 w-7 items-center justify-center rounded-full text-[15px] ${key === today ? "bg-tint font-semibold text-on-tint" : ""}`}>{day}</span>
            )}
            <span className="flex gap-0.5">
              {(byDay.get(key) ?? []).slice(0, 3).map((p) => <span key={p.id} title={p.status.label} className={`h-1.5 w-1.5 rounded-full ${statusDotClass(p.status)}`} />)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function CalendarEntry({ post, role, onChanged }: { post: Post; role: Role; onChanged: () => void }) {
  const failure = post.outcome.failure;
  return (
    <article data-post-id={post.id}>
      <Link href={`/posts/view/?id=${encodeURIComponent(post.id)}`} className="flex min-h-11 items-center gap-3 px-4 py-2.5 active:bg-fill">
        <span className="min-w-0 flex-1">
          <span className="block truncate">{post.headline()}</span>
          <span className="block text-[13px] text-secondary-label">{formatDateTime(post.calendarDate()!)}</span>
        </span>
        <StatusBadge status={post.status} />
        <Chevron />
      </Link>
      {failure && (
        <div className="space-y-2 px-4 pb-3">
          <p className="text-[13px] text-destructive">{failure.message}</p>
          <p className="text-[13px] text-secondary-label">{failure.guidance()}</p>
          {post.canRetry(role) && <RetryForm postId={post.id} onDone={onChanged} />}
        </div>
      )}
    </article>
  );
}
