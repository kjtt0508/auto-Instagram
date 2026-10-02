// HIG のセグメンテッドコントロール: 少数の排他的な選択肢を横に並べる（投稿種別・PR区分など）
export function SegmentedControl<T extends { code: string; label: string }>({ label, options, selected, onSelect }: {
  label: string; options: readonly T[]; selected: T; onSelect: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-[9px] bg-fill p-0.5">
      {options.map((o) => (
        <button key={o.code} type="button" role="radio" aria-checked={o === selected} onClick={() => onSelect(o)}
          className="min-h-8 flex-1 rounded-[7px] px-3 text-[15px] aria-checked:bg-cell aria-checked:font-semibold aria-checked:shadow-sm">
          {o.label}
        </button>
      ))}
    </div>
  );
}
