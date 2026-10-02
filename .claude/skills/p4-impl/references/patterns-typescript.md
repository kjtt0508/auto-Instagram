# TypeScript（frontend/src/domain）実装パターン

domain ディレクトリは React / Vue / Next / fetch / ORM に依存しない。UI からは domain を使うが逆は禁止（フックの依存方向チェック + 任意で eslint アダプタ）。Node サーバ（Express / NestJS 等）でも同じ。

## 値オブジェクト
```ts
export class Quantity {
  static readonly MIN = 1;
  static readonly MAX = 99;
  private constructor(readonly value: number) {}

  static of(value: number): Result<Quantity, string> {
    if (!Number.isInteger(value) || value < Quantity.MIN || value > Quantity.MAX) {
      return err(`数量は${Quantity.MIN}〜${Quantity.MAX}で指定してください`);
    }
    return ok(new Quantity(value));
  }
  equals(other: Quantity): boolean { return this.value === other.value; }
}
```

## Result 型（null を返さない P13）
```ts
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
export const ok = <T>(value: T) => ({ ok: true, value }) as const;
export const err = <E>(error: E) => ({ ok: false, error }) as const;
```

## 区分
```ts
export const DeliveryType = {
  STANDARD: { label: "通常便", shippingFee: (amount: Money) => (amount.isAtLeast(5000) ? Money.zero() : Money.of(600)) },
  EXPRESS:  { label: "速達",   shippingFee: () => Money.of(1200) },
  PICKUP:   { label: "店頭受取", shippingFee: () => Money.zero() },
} as const satisfies Record<string, { label: string; shippingFee: (a: Money) => Money }>;
export type DeliveryTypeCode = keyof typeof DeliveryType;
```

## API レスポンス → ドメイン
- `src/lib/api/*` で受け取り、`src/domain` のファクトリで変換。変換失敗は画面にエラーとして出す。
- サーバの区分コード（`"STANDARD"`）は `DeliveryTypeCode` 型で受ける。文字列比較の if を画面に書かない。
