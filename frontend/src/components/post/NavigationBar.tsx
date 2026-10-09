/** HIG のナビゲーションバー: 左にキャンセル、中央に題名 */
export function NavigationBar({ title, onCancel }: { title: string; onCancel: () => void }) {
  return (
    <header className="-mx-4 mb-2 grid grid-cols-[1fr_auto_1fr] items-center px-2">
      <button type="button" onClick={onCancel} className="min-h-11 justify-self-start px-2 text-[17px] text-tint active:opacity-60">キャンセル</button>
      <h1 className="text-[17px] font-semibold">{title}</h1>
      <span />
    </header>
  );
}
