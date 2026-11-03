"use client";

import { Button } from "@/components/ui/Button";
import { Cell, GroupedSection } from "@/components/ui/Grouped";
import { ClosingContent } from "@/domain/slide/ClosingContent";
import type { useClosingImages } from "./useClosingImages";

const NOTE = `最大${ClosingContent.MAX_IMAGES}枚。縦500px・横400px 以上の PNG か JPEG。4:5 に中央を切り抜いて保存します。最後のスライドの真ん中に、1枚目を左・2枚目を右に並べます`;

/** S-15 の「最後のスライドの画像」のグループ（ロゴの次）。1枚目・2枚目を 4:5 のサムネイルで横に並べ、選び直す・外す・追加する（REQ-007） */
export function ClosingImagesGroup({ images, busy }: { images: ReturnType<typeof useClosingImages>; busy: boolean }) {
  const { list, error, converting, pick, remove, urlOf } = images;
  const disabled = busy || converting;
  const footer = (
    <>
      {error && <span role="alert" className="block text-destructive">{error}</span>}
      <span className="block">{NOTE}</span>
    </>
  );
  return (
    <GroupedSection title="最後のスライドの画像" label="最後のスライドの画像" footer={footer}>
      {list.count() > 0 && (
        <Cell>
          <ul className="flex justify-center gap-4">
            {list.refs().map((path, index) => (
              <li key={path} className="w-[40%] max-w-40">
                {/* eslint-disable-next-line @next/next/no-img-element -- 設定の画像のプレビュー（期限付き URL・blob URL） */}
                <img src={urlOf(path)} alt={`最後のスライドの画像 ${index + 1}枚目`} className="aspect-[4/5] w-full rounded-md bg-fill object-cover" />
                <FileButton label={`${index + 1}枚目を選び直す`} text="選び直す" disabled={disabled} onFile={(f) => pick(index, f)} />
                <Button variant="destructive" block disabled={disabled} aria-label={`${index + 1}枚目を外す`} onClick={() => remove(index)}>外す</Button>
              </li>
            ))}
          </ul>
        </Cell>
      )}
      {list.canAdd() && <FileButton label="最後のスライドの画像を追加" text="画像を追加" disabled={disabled} onFile={(f) => pick(null, f)} />}
    </GroupedSection>
  );
}

function FileButton({ label, text, disabled, onFile }: { label: string; text: string; disabled: boolean; onFile: (file: File | undefined) => void }) {
  return (
    <label className={`flex min-h-11 items-center justify-center px-4 py-2.5 text-[17px] text-tint ${disabled ? "opacity-40" : "cursor-pointer active:bg-fill"}`}>
      {text}
      <input type="file" accept="image/png,image/jpeg" aria-label={label} disabled={disabled} className="sr-only"
        onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
    </label>
  );
}
