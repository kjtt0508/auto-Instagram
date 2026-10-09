/** 背景写真: 表紙の背景に使う、団体が登録したキャンパスの写真（説明文は1〜100文字）。写真IDと保存先は登録で決まる */
export class BackgroundPhoto {
  static readonly DESCRIPTION_MAX = 100;

  private constructor(
    readonly id: string,
    readonly storagePath: string,
    readonly description: string,
  ) {}

  static restore(parts: { id: string; storagePath: string; description: string }): BackgroundPhoto {
    if (BackgroundPhoto.violationsOfDescription(parts.description).length > 0) throw new Error("背景写真の説明文は1〜100文字です");
    return new BackgroundPhoto(parts.id, parts.storagePath, parts.description);
  }

  /** 説明文が満たさない条件（1〜100文字。コードポイントで数える） */
  static violationsOfDescription(description: string): string[] {
    const length = [...description.trim()].length;
    if (length < 1) return ["説明文を入力してください（AI が話題に合う写真を選ぶ手がかりになります）"];
    if (length > BackgroundPhoto.DESCRIPTION_MAX) return [`説明文は${BackgroundPhoto.DESCRIPTION_MAX}文字までです（${length}文字）`];
    return [];
  }
}

/** 背景写真一覧: 団体が使っている背景写真の並び（「使わない」にしたものを除く。最大30枚） */
export class BackgroundPhotoList {
  static readonly MAX = 30;

  private constructor(private readonly items: readonly BackgroundPhoto[]) {}

  static of(photos: readonly BackgroundPhoto[]): BackgroundPhotoList {
    if (photos.length > BackgroundPhotoList.MAX) throw new Error(`背景写真は${BackgroundPhotoList.MAX}枚までです`);
    return new BackgroundPhotoList([...photos]);
  }

  photos(): readonly BackgroundPhoto[] {
    return this.items;
  }

  count(): number {
    return this.items.length;
  }

  /** 写真を足せるか（30枚未満） */
  canAdd(): boolean {
    return this.items.length < BackgroundPhotoList.MAX;
  }

  /** AI に渡す候補（写真IDと説明文） */
  candidates(): { id: string; description: string }[] {
    return this.items.map((p) => ({ id: p.id, description: p.description }));
  }
}
