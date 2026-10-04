/**
 * 下書き案の出力 JSON（Gemini の responseSchema / 手動コピペの貼り付け）を読む。形が違う箇所は、場所を添えた違反として集める。
 * 出力 JSON の形（REQ-002 設計 4章・BR-002-03）:
 *   { cover: { target, keyword, annotation?, closingWords, accent },   // accent は PURPLE | RED | TEAL
 *     backgroundPhotoId?,                                               // 背景写真の候補から選んだ写真ID
 *     slides: [{ heading, description, emphases: string[], pictureBrief, needsReplacement }],
 *     caption, additionalHashtags: string[], prCategory,               // NONE | PR
 *     sourceUrls: string[] }
 */
export function readDraftJson(raw: unknown) {
  const errors: string[] = [];
  const root = record(raw, "出力", errors);
  const cover = record(root.cover, "cover", errors);
  const slides = list(root.slides, "slides", errors).map((s, i) => {
    const slide = record(s, `slides[${i}]`, errors);
    const at = (key: string) => `slides[${i}].${key}`;
    return {
      heading: text(slide.heading, at("heading"), errors),
      description: text(slide.description, at("description"), errors),
      emphases: slide.emphases === undefined ? [] : texts(slide.emphases, at("emphases"), errors),
      pictureBrief: text(slide.pictureBrief, at("pictureBrief"), errors),
      needsReplacement: slide.needsReplacement === true,
    };
  });
  const value = {
    cover: {
      target: text(cover.target, "cover.target", errors),
      keyword: text(cover.keyword, "cover.keyword", errors),
      annotation: cover.annotation === undefined ? "" : text(cover.annotation, "cover.annotation", errors),
      closingWords: text(cover.closingWords, "cover.closingWords", errors),
      accentCode: text(cover.accent, "cover.accent", errors),
    },
    backgroundPhotoId: typeof root.backgroundPhotoId === "string" && root.backgroundPhotoId !== "" ? root.backgroundPhotoId : undefined,
    slides,
    caption: text(root.caption, "caption", errors),
    additionalHashtags: texts(root.additionalHashtags, "additionalHashtags", errors),
    prCategoryCode: text(root.prCategory, "prCategory", errors),
    sourceUrls: root.sourceUrls === undefined ? [] : texts(root.sourceUrls, "sourceUrls", errors),
  };
  return { errors, value };
}

function record(value: unknown, path: string, errors: string[]): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  errors.push(`${path} はオブジェクトで指定してください`);
  return {};
}

function list(value: unknown, path: string, errors: string[]): unknown[] {
  if (Array.isArray(value)) return value;
  errors.push(`${path} は配列で指定してください`);
  return [];
}

function text(value: unknown, path: string, errors: string[]): string {
  if (typeof value === "string") return value;
  errors.push(`${path} は文字列で指定してください`);
  return "";
}

function texts(value: unknown, path: string, errors: string[]): string[] {
  return list(value, path, errors).map((v, i) => text(v, `${path}[${i}]`, errors));
}
