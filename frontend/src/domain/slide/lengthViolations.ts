/** 文字数の検査（コードポイントで数える。絵文字は1文字。REQ-002 BR-002-18）。表紙の文言・スライドの文言・下書き案で共通 */
export function lengthViolations(label: string, text: string, min: number, max: number): string[] {
  const length = [...text].length;
  if (length >= min && length <= max) return [];
  const range = min > 0 ? `${min}〜${max}文字にしてください` : `${max}文字以内にしてください`;
  return [`${label}は${range}（${length}文字）`];
}
