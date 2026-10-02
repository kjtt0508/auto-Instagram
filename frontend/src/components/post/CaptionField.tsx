import { GroupedSection } from "@/components/ui/Grouped";
import { Caption } from "@/domain/post/Caption";
import { Hashtag } from "@/domain/post/Hashtag";

/** キャプション欄: 残り文字数とハッシュタグ数を出し、不備は欄の下に出す（AC-001-08） */
export function CaptionField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const violations = Caption.violationsOf(value);
  const length = [...value].length;
  const footer = (
    <>
      <span className="block text-right">
        {length.toLocaleString("ja-JP")} / {Caption.MAX_LENGTH.toLocaleString("ja-JP")}文字・ハッシュタグ {Hashtag.countIn(value)} / {Caption.MAX_HASHTAGS}個
      </span>
      {violations.map((v) => <span key={v} role="alert" className="block text-destructive">{v}</span>)}
    </>
  );
  return (
    <GroupedSection title="キャプション" footer={footer}>
      <textarea id="caption" aria-label="キャプション" rows={8} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder="本文とハッシュタグ" className="block w-full resize-y bg-transparent px-4 py-3 text-[17px] outline-none" />
    </GroupedSection>
  );
}
