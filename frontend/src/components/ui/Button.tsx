import type { ButtonHTMLAttributes } from "react";

// HIG のボタン: 主な操作は塗り（filled）、ほかは色付きの文字（plain）か薄い塗り（tinted）。破壊的な操作は赤。高さは44pt以上
const STYLES = {
  filled: "bg-tint text-on-tint font-semibold",
  tinted: "bg-tint/15 text-tint font-semibold",
  plain: "text-tint",
  destructive: "text-destructive",
  "destructive-filled": "bg-destructive text-on-tint font-semibold",
} as const;

export function Button({ variant = "plain", block = false, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof STYLES; block?: boolean;
}) {
  return (
    <button type="button" {...props}
      className={`min-h-11 rounded-control px-4 py-2.5 text-[17px] transition-opacity active:opacity-60 disabled:opacity-40 ${block ? "w-full" : ""} ${STYLES[variant]} ${className}`} />
  );
}

/** グループのセルとして並べるボタン（行全体がボタン。文字は中央か左） */
export function CellButton({ variant = "plain", align = "center", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "plain" | "destructive"; align?: "center" | "left";
}) {
  return (
    <button type="button" {...props}
      className={`block min-h-11 w-full px-4 py-2.5 text-[17px] active:bg-fill disabled:opacity-40 ${align === "center" ? "text-center" : "text-left"} ${STYLES[variant]} ${className}`} />
  );
}
