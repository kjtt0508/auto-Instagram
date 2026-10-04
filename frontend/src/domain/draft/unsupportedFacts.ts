/**
 * ネタに無い情報の検出（チェック項目 UNSUPPORTED_FACT。REQ-002 BR-002-10）:
 * 文言から日付・時刻・金額・URL を抜き出す。表記ゆれは揃えて比べる
 * （全角→半角、「11月3日」↔「11/3」、「10時」↔「10:00」、「¥1,000」↔「1000円」）。
 * 年は比べない（「2026年11月3日」と「11月3日」は同じ日付）。DB には記録せず、値として返すだけ
 */
const DIGIT = "[0-9０-９]";
const NUMBER = `${DIGIT}(?:${DIGIT}|[,，])*(?:[.．]${DIGIT}+)?`;
const YEAR_PREFIX = `(?:${DIGIT}{4}[年/／])?`;

const URL_PATTERN = /https?:\/\/[^\s、。，,）)」』]+/gu;
const PATTERNS: readonly { regex: RegExp; keyOf: (match: string) => string }[] = [
  { regex: new RegExp(`${YEAR_PREFIX}${DIGIT}{1,2}月${DIGIT}{1,2}日`, "gu"), keyOf: (m) => dateKey(m) },
  { regex: new RegExp(`(?<![0-9０-９/／.])${YEAR_PREFIX}${DIGIT}{1,2}[/／]${DIGIT}{1,2}(?![0-9０-９/／])`, "gu"), keyOf: (m) => dateKey(m) },
  { regex: new RegExp(`${DIGIT}{1,2}[:：]${DIGIT}{2}`, "gu"), keyOf: (m) => timeKey(m) },
  { regex: new RegExp(`${DIGIT}{1,2}時(?:${DIGIT}{1,2}分)?`, "gu"), keyOf: (m) => timeKey(m) },
  { regex: new RegExp(`[¥￥]${NUMBER}`, "gu"), keyOf: (m) => yenKey(m) },
  { regex: new RegExp(`${NUMBER}万?円`, "gu"), keyOf: (m) => yenKey(m) },
];

const halfWidth = (value: string): string => value.normalize("NFKC");

function dateKey(match: string): string {
  const [month, day] = halfWidth(match).replace(/^\d{4}[年/]/u, "").split(/[月/日]/u);
  return `date:${Number(month)}/${Number(day)}`;
}

function timeKey(match: string): string {
  const [hour, minute] = halfWidth(match).split(/[:時分]/u);
  return `time:${Number(hour)}:${Number(minute || 0)}`;
}

function yenKey(match: string): string {
  const normalized = halfWidth(match).replace(/[¥,円]/gu, "");
  const amount = normalized.endsWith("万") ? Number(normalized.slice(0, -1)) * 10000 : Number(normalized);
  return `yen:${amount}`;
}

/** 文言に含まれる日付・時刻・金額・URL（比べるための印 key と、文言にあった形 text） */
export function extractFacts(source: string): { key: string; text: string }[] {
  const urls = [...source.matchAll(URL_PATTERN)].map((m) => ({ key: `url:${m[0].replace(/\/$/u, "")}`, text: m[0] }));
  // URL の中の「/」や数字を日付・金額と読み違えないよう、URL は同じ長さの空白に置き換えてから探す
  const withoutUrls = source.replace(URL_PATTERN, (m) => " ".repeat(m.length));
  const found = PATTERNS.flatMap(({ regex, keyOf }) => [...withoutUrls.matchAll(regex)].map((m) => ({ key: keyOf(m[0]), text: m[0] })));
  return [...urls, ...found];
}

/** 出力の文言（場所つき）のうち、ネタの本文に無い日付・時刻・金額・URL */
export function unsupportedFactsIn(
  ideaText: string,
  outputs: readonly { location: string; text: string }[],
): { location: string; fact: string }[] {
  const known = new Set(extractFacts(ideaText).map((f) => f.key));
  return outputs.flatMap((o) => extractFacts(o.text).filter((f) => !known.has(f.key)).map((f) => ({ location: o.location, fact: f.text })));
}
