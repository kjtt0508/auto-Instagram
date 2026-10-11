import { BackgroundPhotoOrigin } from "./BackgroundPhotoOrigin";

/**
 * 説明文に入れられない文字: 改行を含む制御文字（Cc）と、行の区切り（Zl）・段落の区切り（Zp）。
 * AI に渡す写真の一覧が1行1枚で並ぶため。DB の RPC（record_generated_background）が拒否する範囲と同じ
 */
const FORBIDDEN_IN_DESCRIPTION = /[\p{Cc}\p{Zl}\p{Zp}]/u;

/** 空白と、説明文に入れられない文字の連なり（初めの値を作るとき、1つの空白にまとめる） */
const SPACES_AND_FORBIDDEN = /[\s\p{Cc}\p{Zl}\p{Zp}]+/gu;

/**
 * 背景写真: 表紙の背景に使う、団体が登録した画像（説明文は1〜100文字）。写真IDと保存先は登録で決まる。
 * 管理者が登録したキャンパスの写真と、AI が作った背景（REQ-006）がある。出どころは背景写真としての採用の記録から導いた値を受け取る
 */
export class BackgroundPhoto {
  static readonly DESCRIPTION_MAX = 100;

  private constructor(
    readonly id: string,
    readonly storagePath: string,
    readonly description: string,
    readonly origin: BackgroundPhotoOrigin,
  ) {}

  /**
   * 記録から戻す。出どころは採用の記録があるかから導いた値（必須）。
   * 説明文は検査しない（過去に登録された写真が、読み込みで落ちないように。CoverText の「記録から戻すときは検査しない」と同じ方針。
   * 新しく登録する経路は violationsOfDescription と DB の RPC が検査する）
   */
  static restore(parts: { id: string; storagePath: string; description: string; origin: BackgroundPhotoOrigin }): BackgroundPhoto {
    return new BackgroundPhoto(parts.id, parts.storagePath, parts.description, parts.origin);
  }

  /**
   * 画像生成の指示から、説明文の初めの値を作る（人が直せる）。改行・連続する空白を1つの空白にまとめ、
   * コードポイントで先頭100文字に切る
   */
  static initialDescription(prompt: string): string {
    const oneLine = prompt.replace(SPACES_AND_FORBIDDEN, " ").trim();
    return [...oneLine].slice(0, BackgroundPhoto.DESCRIPTION_MAX).join("").trim();
  }

  /** AI が作った背景か */
  isGenerated(): boolean {
    return this.origin.isGenerated();
  }

  /** 説明文が満たさない条件（1〜100文字。コードポイントで数える。改行・制御文字を含まない） */
  static violationsOfDescription(description: string): string[] {
    const length = [...description.trim()].length;
    return [
      ...(length < 1 ? ["説明文を入力してください（AI が話題に合う写真を選ぶ手がかりになります）"] : []),
      ...(length > BackgroundPhoto.DESCRIPTION_MAX ? [`説明文は${BackgroundPhoto.DESCRIPTION_MAX}文字までです（${length}文字）`] : []),
      ...(FORBIDDEN_IN_DESCRIPTION.test(description) ? ["説明文に改行や制御文字は入れられません"] : []),
    ];
  }
}

/** 背景写真一覧: 団体が使っている背景写真の並び（「使わない」にしたものを除く。最大30枚。AI が作った背景も数える） */
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

  /** AI に渡す候補（写真IDと説明文）。AI が作った背景も含む */
  candidates(): { id: string; description: string }[] {
    return this.items.map((p) => ({ id: p.id, description: p.description }));
  }
}
