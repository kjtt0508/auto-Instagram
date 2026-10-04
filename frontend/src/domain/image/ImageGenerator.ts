/** 画像生成の提供元: 画像を作る外部サービスとモデル名の組（団体の設定値。LLM の提供元とは別。REQ-005 BR-005-12、ADR-0008） */
export class ImageGenerator {
  private constructor(
    readonly provider: string,
    readonly model: string,
  ) {}

  static of(provider: string, model: string): ImageGenerator {
    if (provider.trim() === "" || model.trim() === "") throw new Error("画像生成の提供元とモデル名は必須です");
    return new ImageGenerator(provider, model);
  }
}
