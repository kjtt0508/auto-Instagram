"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { SessionGate } from "@/components/session/SessionGate";

// HIG のタブバー: 画面下に固定、アイコン＋短いラベル、選択中は tint 色。背景は半透明でぼかす
const TABS = [
  { href: "/", label: "ホーム", icon: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" },
  { href: "/posts/new/", label: "新規投稿", icon: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4.5v9m-4.5-4.5h9" },
  { href: "/settings/", label: "設定", icon: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm7.4-2.1 1.6 1.2-2 3.4-1.9-.7a7 7 0 0 1-1.7 1l-.3 2h-4l-.3-2a7 7 0 0 1-1.7-1l-1.9.7-2-3.4 1.6-1.2a7 7 0 0 1 0-2.8L3 9.4l2-3.4 1.9.7a7 7 0 0 1 1.7-1l.3-2h4l.3 2a7 7 0 0 1 1.7 1l1.9-.7 2 3.4-1.6 1.2a7 7 0 0 1 0 2.8z" },
];

/** スマホ幅（375px）を基準にした画面の枠（00_基本設計 5章） */
export function AppShell({ children }: { children: ReactNode }) {
  // 投稿の作成・編集中はタブバーを隠し、画面下を保存・承認依頼の操作に使う（HIG のモーダルな作業）
  const composing = /^\/posts\/(new|edit)\/?$/.test(usePathname());
  return (
    <SessionGate>
      <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col">
        <main className={`flex-1 px-4 pt-[max(0.5rem,env(safe-area-inset-top))] ${composing ? "pb-4" : "pb-28"}`}>{children}</main>
        {!composing && <TabBar />}
      </div>
    </SessionGate>
  );
}

function TabBar() {
  const pathname = usePathname();
  return (
    <nav aria-label="タブ" className="fixed inset-x-0 bottom-0 border-t border-separator bg-bar pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
      <ul className="mx-auto grid max-w-xl grid-cols-3">
        {TABS.map((tab) => (
          <li key={tab.href}>
            <Link href={tab.href} aria-current={pathname === tab.href || (tab.href !== "/" && pathname.startsWith(tab.href)) ? "page" : undefined}
              className="flex min-h-12 flex-col items-center justify-center gap-0.5 pt-1.5 text-[10px] font-medium text-neutral aria-[current=page]:text-tint">
              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6 fill-none stroke-current" strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round">
                <path d={tab.icon} />
              </svg>
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
