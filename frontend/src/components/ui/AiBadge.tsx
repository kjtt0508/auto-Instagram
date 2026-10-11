/**
 * AI が作った背景の小さな印（見分けのためだけ。公開時の「AI生成の表示」ではない。REQ-006）。
 * 写真に重ねるとき（背景写真の選び直し）は className で位置と地色を足し、行に並べるとき（S-14）はそのまま使う
 */
export function AiBadge({ className = "bg-fill text-secondary-label" }: { className?: string }) {
  return (
    <span data-mark="ai-background" className={`inline-block shrink-0 rounded-full px-1.5 text-[12px] font-semibold leading-5 ${className}`}>AI</span>
  );
}
