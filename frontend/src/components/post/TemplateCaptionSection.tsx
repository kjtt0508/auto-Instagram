"use client";

import { Cell, GroupedSection } from "@/components/ui/Grouped";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Caption } from "@/domain/post/Caption";
import { FixedHashtags } from "@/domain/post/FixedHashtags";
import type { PostRevision } from "@/domain/post/PostRevision";
import type { PostStyleSettings } from "@/domain/post/PostStyleSettings";
import { PrCategory } from "@/domain/post/PrCategory";
import { HASHTAG_SEPARATOR, WordsInput, type Fact } from "./SlideFields";

/**
 * S-07 ⑤ キャプション: 本文・追加のハッシュタグ・PR区分と、組み立てた公開用キャプションの全文・残り文字数。
 * 全文の組み立てと上限の判断は PublishCaption（投稿の版）に任せる
 */
export function TemplateCaptionSection({ revision, settings, prLabel, captionText, hashtags, prCategory, facts, onCaption, onHashtags, onPrCategory }: {
  revision: PostRevision; settings: PostStyleSettings; prLabel: string; captionText: string; hashtags: readonly string[];
  prCategory: PrCategory; facts: readonly Fact[];
  onCaption: (text: string) => void; onHashtags: (tags: string[]) => void; onPrCategory: (category: PrCategory) => void;
}) {
  const published = revision.previewCaption(prLabel);
  const remaining = published.remainingLength();
  const captionIssues = Caption.violationsOf(captionText);
  const hashtagIssues = settings.fixedHashtags().violationsOfAdditional(hashtags);
  const factWords = facts.filter((f) => f.location === "caption").map((f) => f.fact);

  return (
    <>
      <GroupedSection title="キャプション" label="キャプション"
        footer={<span className={remaining < 0 ? "text-destructive" : undefined}>公開されるキャプション全体であと {remaining.toLocaleString("ja-JP")} 文字</span>}>
        <Cell>
          <textarea aria-label="キャプション" rows={6} value={captionText} onChange={(e) => onCaption(e.target.value)}
            className="block w-full resize-y bg-transparent text-[17px] outline-none" />
          {[...new Set([...captionIssues, ...published.violations()])].map((v) => (
            <p key={v} data-violation="キャプション" className="pt-1 text-[13px] text-destructive">{v}</p>
          ))}
          {factWords.length > 0 && (
            <p className="pt-1 text-[13px] text-secondary-label">
              ネタに無い情報かもしれません: {factWords.map((f) => <mark key={f} data-mark="unsupported" className="mx-0.5 rounded bg-caution px-1 text-black">{f}</mark>)}
            </p>
          )}
        </Cell>
        <Cell>
          <p className="pb-1 text-[13px] text-secondary-label">
            追加のハッシュタグ（空白で区切る・{FixedHashtags.ADDITIONAL_MAX}個まで。固定のハッシュタグは自動で付きます）
          </p>
          <WordsInput label="追加のハッシュタグ" initial={hashtags} separator={HASHTAG_SEPARATOR} joiner=" " onChange={onHashtags} />
          {hashtagIssues.map((v) => <p key={v} data-violation="追加のハッシュタグ" className="pt-1 text-[13px] text-destructive">{v}</p>)}
        </Cell>
      </GroupedSection>
      <GroupedSection title="PR区分" footer={prCategory.requiresLabel() ? `公開時にキャプションの先頭へ「${prLabel.trim()}」を付けます` : "対価を受けた広告ならPR案件を選びます"}>
        <div className="p-2"><SegmentedControl label="PR区分" options={PrCategory.all()} selected={prCategory} onSelect={onPrCategory} /></div>
      </GroupedSection>
      <GroupedSection title="公開されるキャプション（全文）" label="公開されるキャプション">
        <Cell><p data-testid="publish-caption" className="whitespace-pre-wrap break-words text-[15px]">{published.text}</p></Cell>
      </GroupedSection>
    </>
  );
}
