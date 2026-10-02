// expect: ts.return-null, ts.mutable-property, arch.domain-purity, arch.layer
import { useState } from "react";
import { client } from "../lib/api/client";
export class Quantity {
  value: number;
  private constructor(readonly v: number) { this.value = v; }
  static parse(v: number): Quantity | null { if (v < 1) return null; return new Quantity(v); }
}
