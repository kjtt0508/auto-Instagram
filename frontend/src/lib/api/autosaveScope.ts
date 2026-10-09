// 端末（localStorage）への一時保存の分け方。同じ端末を別の団体・別のメンバーが使っても、他人の入力や他団体の画像の保存先を
// 復元しないよう、キーに団体IDとメンバーIDを含め、サインアウトでまとめて消す

/** 一時保存を使う人（団体とメンバー） */
export type AutosaveScope = { tenantId: string; memberId: string };

/** 一時保存のキーの共通の頭（サインアウトで、この頭のキーをすべて消す。分け方を導入する前のキーも消える） */
const PREFIX = "niijimaig:new-";

export const scopedKey = (name: string, scope: AutosaveScope): string => `${PREFIX}${name}:${scope.tenantId}:${scope.memberId}`;

/** 保存先が自団体のものか（保存先の先頭は団体ID。他団体の画像を指す一時保存は復元しない） */
export const ownsPath = (scope: AutosaveScope, storagePath: string): boolean => storagePath.startsWith(`${scope.tenantId}/`);

/** サインアウトのとき、端末の一時保存（写真の投稿・AIで作る投稿）をすべて消す */
export function forgetAllAutosaves(): void {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((k): k is string => k?.startsWith(PREFIX) === true);
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    // 何もしない
  }
}
