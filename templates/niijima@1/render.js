/*
 * niijima@1 の描画スクリプト。表紙・中のスライド・最後のスライドを1つのページで描き分ける。
 * 文言はすべて textContent で入れる（HTML として解釈しない）。版は変更しない。
 *
 * render(data): data = { slide, settings, images }
 *   slide:    { role: "COVER"|"BODY"|"CLOSING", ... }  役割ごとの値（Java の Slide.renderValues と同じ形）
 *     COVER:   target, keyword, annotation（＼／ や 〜 は文字列に含める。全角の「｜」で左右の2つに分ける）, closingWords, accentStart, accentEnd, background?（画像の参照）
 *     BODY:    heading, segments:[{text, emphasized}] か（description, emphases:[{start, length}] ※コードポイント）,
 *              material?（画像の参照）
 *     CLOSING: pastPosts:[画像の参照]（0〜2件）
 *   settings: { bandText, closingMessage, accountIntroduction, logo?（画像の参照） }
 *   images:   { 画像の参照: data URL }
 * フォントと全画像の decode を待つ Promise を返す。
 *
 * プレビュー: 親ウィンドウから postMessage({ type: "render", requestId, data }) を受け取って描く。
 * 結果は親へ { type: "rendered"|"error", requestId } で返す。
 */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const SECTIONS = { COVER: "cover", BODY: "body", CLOSING: "closing" };

  function setText(id, text) {
    $(id).textContent = String(text == null ? "" : text);
  }

  function imageOf(images, ref) {
    const url = images[ref];
    if (typeof url !== "string" || !url.startsWith("data:") && !url.startsWith("blob:")) {
      throw new Error("画像がありません: " + ref);
    }
    return url;
  }

  function showImage(img, url) {
    img.src = url;
    img.hidden = false;
  }

  /** 強調する語の位置（コードポイント）から、説明文を区切りに分ける */
  function segmentsOf(slide) {
    if (Array.isArray(slide.segments)) return slide.segments;
    const chars = Array.from(String(slide.description || ""));
    const ranges = (slide.emphases || []).slice().sort((a, b) => a.start - b.start);
    const segments = [];
    let cursor = 0;
    for (const range of ranges) {
      if (range.start < cursor || range.start + range.length > chars.length) throw new Error("強調する語の範囲が正しくありません");
      if (range.start > cursor) segments.push({ text: chars.slice(cursor, range.start).join(""), emphasized: false });
      segments.push({ text: chars.slice(range.start, range.start + range.length).join(""), emphasized: true });
      cursor = range.start + range.length;
    }
    if (cursor < chars.length) segments.push({ text: chars.slice(cursor).join(""), emphasized: false });
    return segments;
  }

  /** 添え書き: 全角の「｜」があれば左右の2つ（下に細い線）、無ければ中央に1つ。＼／ や 〜 は文字列に含まれているものをそのまま描く */
  function fillAnnotation(text) {
    const row = $("cover-annotation");
    const parts = String(text || "").split("｜");
    row.classList.toggle("split", parts.length >= 2);
    row.textContent = "";
    const shown = parts.length >= 2 ? [parts[0], parts.slice(1).join("｜")] : parts;
    for (const part of shown) {
      const span = document.createElement("span");
      span.textContent = part;
      row.appendChild(span);
    }
  }

  function fillCover(slide, settings, images) {
    setText("cover-target", slide.target);
    setText("cover-keyword", slide.keyword);
    fillAnnotation(slide.annotation);
    setText("cover-closing-text", slide.closingWords);
    const ribbon = $("cover-closing-text");
    ribbon.style.setProperty("--accent-start", slide.accentStart);
    ribbon.style.setProperty("--accent-end", slide.accentEnd);
    if (!slide.background) return;
    showImage($("cover-bg"), imageOf(images, slide.background));
    $("cover-shade").hidden = false;
  }

  function fillBody(slide, settings, images) {
    setText("body-heading", slide.heading);
    const description = $("body-description");
    for (const segment of segmentsOf(slide)) {
      const span = document.createElement("span");
      if (segment.emphasized) span.className = "em";
      span.textContent = segment.text;
      description.appendChild(span);
    }
    $("body-card").classList.toggle("no-photo", !slide.material);
    if (!slide.material) return;
    const url = imageOf(images, slide.material);
    showImage($("body-material"), url);
    showImage($("body-backdrop"), url);
  }

  function fillClosing(slide, settings, images) {
    setText("closing-message", settings.closingMessage);
    // 1行目は白い枠の紹介、2行目以降は箇条書き
    const lines = String(settings.accountIntroduction || "").split(/\r?\n/);
    setText("closing-intro", lines[0]);
    for (const line of lines.slice(1)) {
      if (line.trim() === "") continue;
      const item = document.createElement("li");
      item.textContent = line;
      $("closing-bullets").appendChild(item);
    }
    if (settings.logo) showImage($("closing-logo"), imageOf(images, settings.logo));
    for (const ref of slide.pastPosts || []) {
      const img = document.createElement("img");
      img.alt = "";
      img.src = imageOf(images, ref);
      $("closing-covers").appendChild(img);
    }
  }

  const FILL = { COVER: fillCover, BODY: fillBody, CLOSING: fillClosing };

  function reset() {
    for (const el of document.querySelectorAll("[data-fit]")) el.style.fontSize = "";
    $("body-description").textContent = "";
    $("cover-shade").hidden = true;
    $("closing-covers").textContent = "";
    $("closing-bullets").textContent = "";
    $("body-material").removeAttribute("src");
    for (const id of ["cover-bg", "body-backdrop", "closing-logo"]) {
      const img = $(id);
      img.removeAttribute("src");
      img.hidden = true;
    }
    for (const id of Object.values(SECTIONS)) $(id).hidden = true;
  }

  function overflows(el) {
    return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
  }

  /** 枠からはみ出さない最大の文字の大きさにする（2px ずつ小さくする） */
  function fit(el) {
    const max = Number(el.dataset.fitMax);
    const min = Number(el.dataset.fitMin);
    for (let size = max; size > min; size -= 2) {
      el.style.fontSize = size + "px";
      if (!overflows(el)) return;
    }
    el.style.fontSize = min + "px";
  }

  function fitAll(root) {
    for (const el of root.querySelectorAll("[data-fit]")) fit(el);
    fit($("band-text"));
  }

  async function loadFonts(root) {
    const text = (root.textContent || "") + ($("band-text").textContent || "");
    await Promise.all([
      document.fonts.load('700 40px "Noto Sans JP"', text),
      document.fonts.load('900 40px "Noto Sans JP"', text),
      document.fonts.load('40px "Noto Color Emoji"', text),
    ]);
    await document.fonts.ready;
  }

  async function decodeImages(root) {
    const images = Array.from(root.querySelectorAll("img")).filter((img) => !img.hidden && img.getAttribute("src"));
    await Promise.all(images.map((img) => img.decode()));
  }

  function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  async function render(data) {
    if (!data || !data.slide) throw new Error("slide が必要です");
    const slide = data.slide;
    const settings = data.settings || {};
    const images = data.images || {};
    const id = SECTIONS[slide.role];
    if (!id) throw new Error("知らない役割です: " + slide.role);
    reset();
    setText("band-text", settings.bandText);
    FILL[slide.role](slide, settings, images);
    $("canvas").dataset.role = slide.role;
    const section = $(id);
    section.hidden = false;
    await loadFonts(section);
    await decodeImages(section);
    fitAll(section);
    await nextFrame();
    await nextFrame();
    return { role: slide.role };
  }

  window.render = render;

  window.addEventListener("message", (event) => {
    if (window.parent === window || event.source !== window.parent) return;
    const message = event.data || {};
    if (message.type !== "render") return;
    const reply = (type) => window.parent.postMessage({ type, requestId: message.requestId }, "*");
    render(message.data).then(() => reply("rendered"), () => reply("error"));
  });
})();
