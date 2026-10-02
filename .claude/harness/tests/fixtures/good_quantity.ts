import type { Result } from "./result";
// a comment with fetch( and return null
export class Quantity {
  static readonly MIN = 1;
  private constructor(readonly value: number) {}
  static of(value: number): Result<Quantity, string> {
    const msg = "http://example.com return null";
    if (value < Quantity.MIN) return { ok: false, error: msg };
    return { ok: true, value: new Quantity(value) };
  }
  equals(o: Quantity): boolean { return this.value === o.value; }
}
