import type { PostStatus } from "@/domain/post/PostStatus";

// 色の意味はドメイン（PostStatus.calendarColor）が決め、ここは iOS のシステムカラーに置き換えるだけ
const COLOR_CLASSES: Record<string, { badge: string; dot: string }> = {
  gray: { badge: "bg-neutral/20 text-secondary-label", dot: "bg-neutral" },
  yellow: { badge: "bg-caution/30 text-label", dot: "bg-caution" },
  blue: { badge: "bg-tint/15 text-tint", dot: "bg-tint" },
  "blue-pulse": { badge: "bg-tint/15 text-tint animate-pulse", dot: "bg-tint animate-pulse" },
  green: { badge: "bg-success/20 text-label", dot: "bg-success" },
  red: { badge: "bg-destructive/15 text-destructive", dot: "bg-destructive" },
};

/** カレンダーの日付に付ける小さな印の色 */
export const statusDotClass = (status: PostStatus): string => COLOR_CLASSES[status.calendarColor()].dot;

export function StatusBadge({ status }: { status: PostStatus }) {
  return (
    <span data-status={status.code}
      className={`inline-block shrink-0 rounded-full px-2 py-0.5 text-[12px] font-semibold ${COLOR_CLASSES[status.calendarColor()].badge}`}>
      {status.label}
    </span>
  );
}
