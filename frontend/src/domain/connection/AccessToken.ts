/** アクセストークン: Instagram API を呼ぶための長期アクセストークン。文字列表現では値を伏せる（ログに出さない） */
export class AccessToken {
  private constructor(private readonly value: string) {}

  static of(value: string): AccessToken {
    if (value.trim() === "") throw new Error("アクセストークンは空にできません");
    return new AccessToken(value);
  }

  /** 暗号化・API 呼び出しのときだけ値を取り出す */
  reveal(): string {
    return this.value;
  }

  toString(): string {
    return "AccessToken(****)";
  }

  toJSON(): string {
    return this.toString();
  }
}
