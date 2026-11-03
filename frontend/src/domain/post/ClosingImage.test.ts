import { describe, expect, it } from "vitest";
import fixture from "../../../../docs/model/fixtures/closing-images.json";
import { ClosingImage } from "./ClosingImage";

describe("最後のスライドの画像の変換の計画（fixtures/closing-images.json）", () => {
  it.each(fixture.plans)("$id $name", (c) => {
    const plan = ClosingImage.planUpload({ width: c.width, height: c.height });
    expect(plan.crop).toEqual(c.crop);
    if ("output" in c) expect(plan.output).toEqual(c.output);
    expect(plan.violation).toBe(c.violation);
  });

  it("AC-007-02 小さい画像の違反の文言は「縦500px・横400px 以上の画像を選んでください」", () => {
    expect(ClosingImage.planUpload({ width: 399, height: 500 }).violation).toBe("縦500px・横400px 以上の画像を選んでください");
  });
});

describe("アップロードできる形式（fixtures/closing-images.json）", () => {
  it.each(fixture.types)("$id $mimeType は受け付ける: $accepted", (c) => {
    expect(ClosingImage.acceptsType(c.mimeType)).toBe(c.accepted);
  });

  it("AC-007-03 形式が違うときの文言は「PNG か JPEG を選んでください」", () => {
    expect(ClosingImage.WRONG_TYPE).toBe("PNG か JPEG を選んでください");
  });
});

describe("最後のスライドの画像", () => {
  it("BR-007-01 保存先は必須", () => {
    expect(() => ClosingImage.restore(" ")).toThrow("必須");
    expect(ClosingImage.restore("t1/style/a.jpg").storagePath).toBe("t1/style/a.jpg");
  });
});
