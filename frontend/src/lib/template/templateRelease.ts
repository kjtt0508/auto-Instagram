/**
 * 画面のビルドに埋め込む、現在のテンプレートの版（リポジトリの templates/<版>/ と同じ名前。ADR-0010）。
 * 保存の RPC に渡し、DB が template_releases と照合する。新しい版を使うときはここを変え、マイグレーションで版を足す
 */
export const CURRENT_TEMPLATE_VERSION = "niijima@1";

/**
 * 中のスライドの素材画像を切り取る縦横比（カードの枠の比率 4:3）。テンプレートの版で決まる値で、niijima@1 のカードの枠に合わせる
 * （設計 3章・templates/niijima@1/style.css）
 */
export const MATERIAL_ASPECT = 4 / 3;

/** プレビューの iframe が読むテンプレートの入口（静的出力の /templates/ にコピーされる） */
export const templatePreviewUrl = (version: string): string => `/templates/${version}/index.html`;
