import type { ReactNode } from "react";

// HIG の「インセットグループ」リスト: 薄いグレーの背景に、角丸のセルをまとめて置く。見出しと補足はセルの外に小さく出す

export function LargeTitle({ children }: { children: ReactNode }) {
  return <h1 className="px-1 pb-2 pt-3 text-[34px] font-bold leading-tight tracking-tight">{children}</h1>;
}

export function GroupedSection({ title, footer, label, children }: {
  title?: string; footer?: ReactNode; label?: string; children: ReactNode;
}) {
  return (
    <section aria-label={label ?? title} className="mt-6 first:mt-2">
      {title && <h2 className="px-4 pb-1.5 text-[13px] text-secondary-label">{title}</h2>}
      <div className="overflow-hidden rounded-cell bg-cell">{children}</div>
      {footer && <div className="px-4 pt-1.5 text-[13px] text-secondary-label">{footer}</div>}
    </section>
  );
}

/** グループ内の1行。2行目以降の上に、左を空けた区切り線を引く */
export function Cell({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`relative min-h-11 px-4 py-2.5 [&+&]:before:absolute [&+&]:before:left-4 [&+&]:before:right-0 [&+&]:before:top-0 [&+&]:before:h-px [&+&]:before:bg-separator [&+&]:before:content-[''] ${className}`}>
      {children}
    </div>
  );
}

/** 右に値を寄せた「ラベル：値」の行 */
export function ValueCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Cell className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <span className="min-w-0 truncate text-right text-secondary-label">{children}</span>
    </Cell>
  );
}

/** 行の右端の「›」（開ける行の印） */
export function Chevron() {
  return (
    <svg viewBox="0 0 8 14" aria-hidden="true" className="h-3.5 w-2 shrink-0 fill-none stroke-tertiary-label" strokeWidth={2} strokeLinecap="round">
      <path d="m1 1 6 6-6 6" />
    </svg>
  );
}

/** 画面の状態の説明（読み込み中・空・エラー） */
export function Placeholder({ children, tone = "secondary" }: { children: ReactNode; tone?: "secondary" | "error" }) {
  return (
    <p role={tone === "error" ? "alert" : undefined}
      className={`px-4 py-10 text-center ${tone === "error" ? "text-destructive" : "text-secondary-label"}`}>{children}</p>
  );
}
