import { Cell, GroupedSection, LargeTitle } from "@/components/ui/Grouped";

const STEPS = [
  "GitHub のリポジトリの「Actions」タブで、tick ワークフローが無効になっていないか確かめ、無効なら「Enable workflow」を押します。",
  "直近の実行が失敗していれば、ログの最初のエラーを確かめます（DB に接続できない・Secrets の期限切れなど）。",
  "直したら tick を「Run workflow」で手動実行し、この警告が消えることを確かめます。",
  "止まっていた間に公開猶予（6時間）を過ぎた投稿は「失敗」になっています。ホームから日時を決めて再実行してください。",
];

/** 「定期処理が止まっています」の警告から開く手順（BATCH_STOPPED） */
export default function RunbookPage() {
  return (
    <>
      <LargeTitle>定期処理が止まっているとき</LargeTitle>
      <p className="px-1 text-[15px] text-secondary-label">
        予約した投稿は15分ごとの定期処理（GitHub Actions）が公開します。最後の稼働から60分以上たつと、この警告が出ます。
      </p>
      <GroupedSection title="手順" footer="GitHub は混雑時に定期実行が数分〜数十分遅れることがあります。予約日時ぴったりの公開は保証されません。">
        {STEPS.map((step, i) => (
          <Cell key={step} className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-tint text-[13px] font-semibold text-on-tint">{i + 1}</span>
            <span className="text-[15px]">{step}</span>
          </Cell>
        ))}
      </GroupedSection>
    </>
  );
}
