import { AccentColor } from "@/domain/slide/AccentColor";

/**
 * 帯の色（7色）を選ぶ色見本のグリッド（REQ-006 設計 3章）。セグメントでは7つが1行に収まらないので、折り返す。
 * 1つの見本が帯のグラデーションの小さな見本で、色名を下に出す。選択中は枠とチェック。
 * 見本の名前（aria-label）は色名、タップ領域は 44pt 以上
 */
export function AccentColorPicker({ label, selected, onSelect }: {
  label: string; selected: AccentColor; onSelect: (accent: AccentColor) => void;
}) {
  return (
    <div role="group" aria-label={label} className="grid grid-cols-4 gap-x-2 gap-y-1">
      {AccentColor.all().map((accent) => {
        const isSelected = accent === selected;
        return (
          <button key={accent.code} type="button" aria-pressed={isSelected} aria-label={accent.label} onClick={() => onSelect(accent)}
            className="flex min-h-14 min-w-11 flex-col items-stretch gap-1 rounded-[8px] py-1 text-center active:opacity-60">
            <span aria-hidden="true" style={{ background: accent.cssBackground() }}
              className={`flex h-8 items-center justify-center rounded-[8px] ${isSelected ? "ring-2 ring-tint ring-offset-2 ring-offset-cell" : ""}`}>
              {isSelected && (
                <svg viewBox="0 0 16 16" className="h-4 w-4 fill-none stroke-white" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                  <path d="m3 8.5 3.2 3.2L13 4.8" />
                </svg>
              )}
            </span>
            <span aria-hidden="true" className={`text-[13px] leading-tight ${isSelected ? "font-semibold" : "text-secondary-label"}`}>{accent.label}</span>
          </button>
        );
      })}
    </div>
  );
}
