import { chromium, expect, test, webkit, type BrowserType, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";

// テンプレート niijima@1（ADR-0010）を、画像化と同じ方法（架空の origin に配り、他の通信を遮断）で chromium と webkit で描く。
// AC-002-01（HTML が文字として出る）/ NFR-002-05（上限文字数で枠からはみ出さない）/ NFR-002-04（chromium と webkit で一致）

const VERSION = "niijima@1";
const ROOT = join(process.cwd(), "..", "templates", VERSION);
const TYPES: Record<string, string> = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".woff2": "font/woff2" };
const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const SETTINGS = { bandText: "新島info", closingMessage: "ご覧いただきありがとうございます", accountIntroduction: "@niijima_info\n同志社大学の学生生活を発信中", logo: "logo" };
const IMAGES = { bg: PIXEL, mat: PIXEL, logo: PIXEL, past1: PIXEL, past2: PIXEL };

type Box = { id: string; fontSize: string; text: { x: number; y: number; w: number; h: number }; box: { x: number; y: number; w: number; h: number }; scrollOverflow: boolean };

async function openPage(type: BrowserType) {
  const browser = await type.launch();
  const context = await browser.newContext({ viewport: { width: 1080, height: 1350 } });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const prefix = `/${VERSION}/`;
    if (url.origin !== "https://template.local" || !url.pathname.startsWith(prefix)) return route.abort();
    const file = normalize(join(ROOT, decodeURIComponent(url.pathname.slice(prefix.length))));
    if (!file.startsWith(ROOT)) return route.abort();
    return route.fulfill({ body: readFileSync(file), contentType: TYPES[extname(file)] ?? "application/octet-stream" });
  });
  const page = await context.newPage();
  await page.goto(`https://template.local/${VERSION}/index.html`);
  return { browser, page };
}

const render = (page: Page, slide: object) => page.evaluate((data) => (window as unknown as { render: (d: unknown) => Promise<unknown> }).render(data), { slide, settings: SETTINGS, images: IMAGES });

/** 文字を描いている要素ごとに、文字の外接矩形と枠の矩形を測る */
const measure = (page: Page) => page.evaluate((): Box[] => {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-fit]")).filter((el) => el.offsetParent !== null).map((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const t = range.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    return {
      id: el.id, fontSize: getComputedStyle(el).fontSize,
      text: { x: t.x, y: t.y, w: t.width, h: t.height }, box: { x: b.x, y: b.y, w: b.width, h: b.height },
      scrollOverflow: el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1,
    };
  });
});

const rep = (s: string, n: number) => s.repeat(n);
const cover = (over: object = {}) => ({ role: "COVER", target: "同志社大学", keyword: "期末試験日程", annotation: "＼ テスト前に確認 ／", closingWords: "まとめたよ", accentStart: "#FD3432", accentEnd: "#FE914C", background: "bg", ...over });
const body = (over: object = {}) => ({ role: "BODY", heading: "学割が使える", segments: [{ text: "学生証を見せるだけで", emphasized: false }, { text: "割引", emphasized: true }, { text: "になります", emphasized: false }], material: "mat", ...over });
const closing = (over: object = {}) => ({ role: "CLOSING", pastPosts: ["past1", "past2"], ...over });

/** 上限の文字数を、最も幅の広い文字・絵文字で埋めた各スライド */
const WORST: Record<string, object> = {
  // キーワードは要件の上限（10文字）より多い12文字まで、1行に収まるよう縮める
  "表紙 幅広の漢字": cover({ target: rep("鬱", 12), keyword: rep("鬱", 12), annotation: rep("鬱", 16), closingWords: rep("鬱", 8) }),
  "表紙 絵文字": cover({ target: rep("😀", 12), keyword: rep("😀", 12), annotation: rep("😀", 16), closingWords: rep("😀", 8), background: undefined }),
  "表紙 英大文字": cover({ keyword: rep("W", 12), annotation: rep("W", 16), closingWords: rep("W", 8) }),
  "表紙 添え書きが左右の2つ": cover({ annotation: `${rep("鬱", 8)}｜${rep("鬱", 8)}`, keyword: "本選考向け EVENT" }),
  "中 幅広の漢字（素材画像あり）": body({ heading: rep("鬱", 16), segments: [{ text: rep("鬱", 120), emphasized: false }] }),
  "中 絵文字（素材画像なし）": body({ heading: rep("👨‍👩‍👧‍👦", 16), segments: [{ text: rep("😀", 120), emphasized: false }], material: undefined }),
  "中 英大文字が区切りなし": body({ heading: rep("W", 16), segments: [{ text: rep("W", 120), emphasized: false }] }),
  "最後 長い定型文": closing(),
};

const BROWSERS: [string, BrowserType][] = [["chromium", chromium], ["webkit", webkit]];

for (const [name, type] of BROWSERS) {
  test.describe(`テンプレート niijima@1 (${name})`, () => {
    test.setTimeout(120_000);

    test("AC-002-01 <script> を含む見出しは、HTML として解釈されず文字として描かれる", async () => {
      const { browser, page } = await openPage(type);
      try {
        const heading = "<script>window.__xss=1</script><img src=x onerror=window.__xss=2>";
        await render(page, body({ heading }));
        expect(await page.locator("#body-heading").textContent()).toBe(heading);
        expect(await page.locator("#body-heading *").count()).toBe(0);
        expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
      } finally {
        await browser.close();
      }
    });

    test("AC-002-02 表紙は3段（対象・キーワード・締めの言葉）で、キーワードは1行・締めの言葉の帯は文字の幅だけ", async () => {
      const { browser, page } = await openPage(type);
      try {
        await render(page, cover({ keyword: rep("鬱", 12), closingWords: "まとめたよ" }));
        const rects = await page.evaluate(() => ["cover-keyword", "cover-closing-text"].map((id) => {
          const r = document.getElementById(id)!.getBoundingClientRect();
          return { w: r.width, h: r.height };
        }));
        expect(rects[0].h).toBeLessThanOrEqual(255); // 折り返していない
        expect(rects[1].w).toBeLessThan(960); // 帯は枠いっぱいではない
        await page.screenshot({ path: `test-results/cover-${name}.jpg`, type: "jpeg", quality: 90 });
      } finally {
        await browser.close();
      }
    });

    test("AC-002-02 強調する語は赤字の要素になり、画像は 1080×1350 で描かれる", async () => {
      const { browser, page } = await openPage(type);
      try {
        await render(page, body({ segments: undefined, description: "😀学割を使おう", emphases: [{ start: 1, length: 2 }] }));
        expect(await page.locator("#body-description .em").allTextContents()).toEqual(["学割"]);
        expect((await page.screenshot({ type: "jpeg", quality: 90 })).length).toBeGreaterThan(1000);
        expect(await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight])).toEqual([1080, 1350]);
      } finally {
        await browser.close();
      }
    });

    for (const [label, slide] of Object.entries(WORST)) {
      test(`NFR-002-05 上限の文字数を最も幅の広い文字で埋めても枠からはみ出さない: ${label}`, async () => {
        const { browser, page } = await openPage(type);
        try {
          await render(page, slide);
          const boxes = await measure(page);
          expect(boxes.length).toBeGreaterThan(0);
          for (const b of boxes) {
            expect(b.scrollOverflow, `${b.id} が枠からあふれている`).toBe(false);
            expect(b.text.x, `${b.id} 左`).toBeGreaterThanOrEqual(b.box.x - 1);
            expect(b.text.y, `${b.id} 上`).toBeGreaterThanOrEqual(b.box.y - 1);
            expect(b.text.x + b.text.w, `${b.id} 右`).toBeLessThanOrEqual(b.box.x + b.box.w + 1);
            expect(b.text.y + b.text.h, `${b.id} 下`).toBeLessThanOrEqual(b.box.y + b.box.h + 1);
            expect(b.box.x + b.box.w).toBeLessThanOrEqual(1081);
            expect(b.box.y + b.box.h).toBeLessThanOrEqual(1351);
          }
        } finally {
          await browser.close();
        }
      });
    }
  });
}

test("NFR-002-04 chromium と webkit で同じデータを描いた文字の位置が許容差の中で一致する", async () => {
  test.setTimeout(180_000);
  const results: Record<string, Box[][]> = {};
  for (const [name, type] of BROWSERS) {
    const { browser, page } = await openPage(type);
    try {
      results[name] = [];
      for (const slide of [cover(), body({ heading: "学割が使える😀" }), closing()]) {
        await render(page, slide);
        results[name].push(await measure(page));
      }
    } finally {
      await browser.close();
    }
  }
  const TOLERANCE = 48; // px（1080px 幅の約4.5%）。フォントの描画エンジンの差を許す
  results.chromium.forEach((boxes, i) => {
    expect(results.webkit[i].map((b) => b.id)).toEqual(boxes.map((b) => b.id));
    boxes.forEach((b, j) => {
      const w = results.webkit[i][j];
      expect(Math.abs(b.text.x - w.text.x), `${b.id} x`).toBeLessThanOrEqual(TOLERANCE);
      expect(Math.abs(b.text.y - w.text.y), `${b.id} y`).toBeLessThanOrEqual(TOLERANCE);
      expect(Math.abs(b.text.w - w.text.w), `${b.id} 幅`).toBeLessThanOrEqual(TOLERANCE);
      expect(Math.abs(b.text.h - w.text.h), `${b.id} 高さ`).toBeLessThanOrEqual(TOLERANCE);
    });
  });
});
