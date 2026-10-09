"use client";

import { useEffect, useRef, useState } from "react";
import type { PostStyleSettings } from "@/domain/post/PostStyleSettings";
import type { Slide } from "@/domain/slide/Slide";
import type { SlideList } from "@/domain/slide/SlideList";
import { previewImages } from "@/lib/template/previewImages";
import { templatePreviewUrl } from "@/lib/template/templateRelease";

const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1350;

type Status = "loading" | "rendered" | "error";

/**
 * スライドのプレビュー（横スワイプ）。テンプレート（/templates/<版>/index.html）を sandbox の iframe に読み、
 * 文言と画像は postMessage で渡す（ADR-0010。srcdoc は使わない。文言は iframe 内で textContent として描かれる）。
 * 1080×1350 を縮小して表示する。onSelect を渡すと、スライドを選べる（編集するスライドの切り替え）
 */
export function SlidePreview({ slides, settings, templateVersion, selectedIndex, onSelect, closingNote }: {
  slides: SlideList; settings: PostStyleSettings; templateVersion: string;
  selectedIndex?: number; onSelect?: (index: number) => void;
  /** 最後のスライドの下に出す注記 */
  closingNote?: string;
}) {
  const images = useSlideImages(slides, settings);
  const items = slides.items();
  return (
    <ul aria-label="スライドのプレビュー" className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 pt-2">
      {items.map((slide, index) => {
        const caption = captionOf(slide, index, items);
        const selected = selectedIndex === index;
        return (
          <li key={index} className="w-[72%] shrink-0 snap-center">
            <div className={`rounded-cell ${selected ? "ring-4 ring-tint" : ""}`}>
              <SlideFrame slide={slide} settings={settings} version={templateVersion} images={images} label={caption} />
            </div>
            <div className="flex min-h-9 items-center justify-between gap-2 pt-1 text-[13px]">
              {onSelect ? (
                <button type="button" aria-pressed={selected} onClick={() => onSelect(index)} className="min-h-9 text-tint aria-pressed:font-semibold">
                  {caption}{selected ? "（編集中）" : "を編集"}
                </button>
              ) : <span className="text-secondary-label">{caption}</span>}
              {slide.bodyContent()?.brief.needsReplacement() && (
                <span data-mark="replacement" className="shrink-0 whitespace-nowrap rounded-full bg-caution px-2 py-0.5 font-semibold text-black">差し替えが必要</span>
              )}
            </div>
            {closingNote && index === items.length - 1 && <p className="text-[13px] text-secondary-label">{closingNote}</p>}
          </li>
        );
      })}
    </ul>
  );
}

function captionOf(slide: Slide, index: number, all: readonly Slide[]): string {
  const bodyNumber = all.slice(0, index + 1).filter((s) => s.bodyContent()).length;
  return slide.bodyContent() ? `${slide.role.label}${bodyNumber}` : slide.role.label;
}

/** スライド全体で使う画像（背景写真・素材画像・ロゴ）を data URL にして持つ。読み込めた保存先だけが入る */
function useSlideImages(slides: SlideList, settings: PostStyleSettings): { map: Map<string, string>; done: boolean } {
  const paths = [...slides.imageRefs(), ...(settings.logoStoragePath ? [settings.logoStoragePath] : [])];
  const key = paths.join("|");
  const [loaded, setLoaded] = useState<{ key: string; map: Map<string, string> }>({ key: "", map: new Map() });
  useEffect(() => {
    let cancelled = false;
    previewImages(key === "" ? [] : key.split("|")).catch(() => new Map<string, string>())
      .then((map) => { if (!cancelled) setLoaded({ key, map }); });
    return () => { cancelled = true; };
  }, [key]);
  // 読み込み中の間も、前に読めた画像はそのまま使う（編集のたびにちらつかせない）
  return { map: loaded.map, done: loaded.key === key };
}

function SlideFrame({ slide, settings, version, images, label }: {
  slide: Slide; settings: PostStyleSettings; version: string; images: { map: Map<string, string>; done: boolean }; label: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);
  const [scale, setScale] = useState(0.25);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<Status>("loading");

  const refs = [...slide.imageRefs(), ...(slide.closingContent() && settings.logoStoragePath ? [settings.logoStoragePath] : [])];
  const present = Object.fromEntries(refs.flatMap((r) => (images.map.has(r) ? [[r, images.map.get(r)!]] : [])));
  const ready = refs.every((r) => images.map.has(r));
  const imagesFailed = images.done && !ready;
  const payload = ready ? JSON.stringify({ slide: slide.renderValues(), settings: settings.renderValues(), images: present }) : null;

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / CANVAS_WIDTH));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!loaded || payload === null) return;
    requestId.current += 1;
    frame.current?.contentWindow?.postMessage({ type: "render", requestId: requestId.current, data: JSON.parse(payload) }, "*");
  }, [loaded, payload]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const message = event.data as { type?: string; requestId?: number } | null;
      if (message?.requestId !== requestId.current) return;   // 古い依頼の結果は捨てる
      if (message.type === "rendered") setStatus("rendered");
      if (message.type === "error") setStatus("error");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <div ref={box} data-render-status={imagesFailed ? "error" : status} className="relative w-full overflow-hidden rounded-cell bg-fill"
      style={{ aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}` }}>
      <iframe ref={frame} title={`${label}のプレビュー`} sandbox="allow-scripts" src={templatePreviewUrl(version)} tabIndex={-1}
        onLoad={() => setLoaded(true)}
        style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT, border: 0, transform: `scale(${scale})`, transformOrigin: "top left", pointerEvents: "none" }} />
      {(status === "error" || imagesFailed) && (
        <p className="absolute inset-0 flex items-center justify-center bg-fill px-4 text-center text-[13px] text-destructive">
          {imagesFailed ? "画像を読み込めません" : "プレビューを描けません"}
        </p>
      )}
    </div>
  );
}
