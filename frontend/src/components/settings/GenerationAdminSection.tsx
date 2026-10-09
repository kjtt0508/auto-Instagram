"use client";

import Link from "next/link";
import { Chevron, GroupedSection } from "@/components/ui/Grouped";

const ITEMS = [
  { href: "/settings/backgrounds/", label: "背景写真" },
  { href: "/settings/style/", label: "投稿の型の設定" },
  { href: "/settings/prompts/", label: "プロンプト版" },
];

/** S-11 ③ 下書きの生成（管理者だけに出す）: S-14 背景写真・S-15 投稿の型の設定・S-10 プロンプト版への入口 */
export function GenerationAdminSection() {
  return (
    <GroupedSection title="下書きの生成" footer="表紙の背景写真・固定の文言・AI への指示を直します。管理者だけが使えます">
      <ul>
        {ITEMS.map((item) => (
          <li key={item.href} className="[&+&]:border-t [&+&]:border-separator">
            <Link href={item.href} className="flex min-h-11 items-center justify-between gap-3 px-4 py-2.5 active:bg-fill">
              <span>{item.label}</span><Chevron />
            </Link>
          </li>
        ))}
      </ul>
    </GroupedSection>
  );
}
