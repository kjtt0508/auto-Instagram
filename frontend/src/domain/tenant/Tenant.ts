/** 団体: このシステムを使う単位（当面は新島infoだけ）。画面では設定（PR表記など）を返す */
export class Tenant {
  private constructor(
    readonly id: string,
    readonly name: string,
    readonly prLabel: string,
  ) {}

  static restore(parts: { id: string; name: string; prLabel: string }): Tenant {
    if (parts.id === "") throw new Error("団体IDは必須です");
    if (parts.prLabel === "") throw new Error("PR表記は必須です");
    return new Tenant(parts.id, parts.name, parts.prLabel);
  }

  /** 投稿画像のアップロード先（uploads-private/{団体ID}/posts/…。RPC が団体IDで始まるか確かめる） */
  uploadPathFor(fileId: string): string {
    return `${this.id}/posts/${fileId}.jpg`;
  }

  /** 背景写真の保存先（uploads-private/{団体ID}/backgrounds/…。JPEG。管理者だけが書ける） */
  backgroundPathFor(fileId: string): string {
    return `${this.id}/backgrounds/${fileId}.jpg`;
  }

  /** 投稿の型の設定のロゴの保存先（uploads-private/{団体ID}/style/…。PNG。管理者だけが書ける） */
  logoPathFor(fileId: string): string {
    return `${this.id}/style/${fileId}.png`;
  }
}
