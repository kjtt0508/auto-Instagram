import { describe, expect, it } from "vitest";
import { PostStyleSettings } from "./PostStyleSettings";

const valid = { coverTargets: ["同志社大学"], captionFooter: "定型の文面", fixedHashtags: ["#同志社大学", "#同志社"] };
const none = { coverTargets: [], captionFooter: [], fixedHashtags: [] };

describe("投稿の型の設定の入力（BR-002-17）", () => {
  it("BR-002-17 条件を満たす入力に違反は無い", () => {
    expect(PostStyleSettings.violationsOfInput(valid)).toEqual(none);
    expect(PostStyleSettings.violationsOfInput({ ...valid, fixedHashtags: [] })).toEqual(none);
  });

  it("BR-002-17 表紙の対象の候補が 0件なら違反", () => {
    expect(PostStyleSettings.violationsOfInput({ ...valid, coverTargets: [] }).coverTargets).toHaveLength(1);
  });

  it("BR-002-17 キャプションの定型が空（空白だけ）なら違反", () => {
    expect(PostStyleSettings.violationsOfInput({ ...valid, captionFooter: " \n" }).captionFooter).toHaveLength(1);
  });

  it("BR-002-17 固定ハッシュタグは、ハッシュタグの形でないものを挙げる", () => {
    expect(PostStyleSettings.violationsOfInput({ ...valid, fixedHashtags: ["#学割", "学割", "#"] }).fixedHashtags)
      .toEqual(["ハッシュタグの形が正しくありません: 学割", "ハッシュタグの形が正しくありません: #"]);
  });
});
