import { describe, expect, it } from "vitest";
import { sampleBody, sampleCoverText } from "../__tests__/samples";
import { BackgroundPhoto, BackgroundPhotoList } from "./BackgroundPhotoList";
import { BackgroundPhotoOrigin } from "./BackgroundPhotoOrigin";
import { ClosingContent } from "./ClosingContent";
import { CoverContent } from "./CoverContent";
import { Slide } from "./Slide";
import { SlideList } from "./SlideList";

const photo = (n: number, origin: BackgroundPhotoOrigin = BackgroundPhotoOrigin.REGISTERED) =>
  BackgroundPhoto.restore({ id: `bg-${n}`, storagePath: `t1/backgrounds/${n}.jpg`, description: `写真${n}`, origin });
const photos = (n: number) => Array.from({ length: n }, (_, i) => photo(i + 1));

// 行の区切り・段落の区切りは、ソースに直接書かず文字コードから作る
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

describe("背景写真一覧（BR-002-21）", () => {
  it("AC-002-24 使う写真が29枚までは足せて、30枚になったら足せない", () => {
    expect(BackgroundPhotoList.of(photos(0)).canAdd()).toBe(true);
    expect(BackgroundPhotoList.of(photos(29)).canAdd()).toBe(true);
    expect(BackgroundPhotoList.of(photos(30)).canAdd()).toBe(false);
  });

  it("31枚の一覧は作れない", () => {
    expect(() => BackgroundPhotoList.of(photos(31))).toThrow("30枚まで");
  });

  it("AC-002-16 AI に渡す候補は、写真IDと説明文だけ（0枚なら空）", () => {
    expect(BackgroundPhotoList.of(photos(0)).candidates()).toEqual([]);
    expect(BackgroundPhotoList.of(photos(2)).candidates()).toEqual([{ id: "bg-1", description: "写真1" }, { id: "bg-2", description: "写真2" }]);
  });

  it("AC-006-07 BR-006-05 AI が作った背景も30枚に数える（29枚のうち AI が作った背景があっても足せて、30枚で足せない）", () => {
    const mixed = (n: number) => Array.from({ length: n }, (_, i) => photo(i + 1, i % 2 === 0 ? BackgroundPhotoOrigin.GENERATED : BackgroundPhotoOrigin.REGISTERED));
    expect(BackgroundPhotoList.of(mixed(29)).canAdd()).toBe(true);
    expect(BackgroundPhotoList.of(mixed(30)).canAdd()).toBe(false);
    expect(BackgroundPhotoList.of(mixed(30)).count()).toBe(30);
  });

  it("AC-006-11 AI が作った背景も、AI に渡す候補（写真IDと説明文）に出る", () => {
    const list = BackgroundPhotoList.of([photo(1), photo(2, BackgroundPhotoOrigin.GENERATED)]);
    expect(list.candidates()).toEqual([{ id: "bg-1", description: "写真1" }, { id: "bg-2", description: "写真2" }]);
  });
});

describe("背景写真の説明文（BR-002-21）", () => {
  it("AC-002-24 AC-006-04 1〜100文字ならよい（1文字・100文字ちょうどはよい）", () => {
    expect(BackgroundPhoto.violationsOfDescription("正")).toEqual([]);
    expect(BackgroundPhoto.violationsOfDescription("正門")).toEqual([]);
    expect(BackgroundPhoto.violationsOfDescription("あ".repeat(100))).toEqual([]);
  });

  it("AC-002-24 空（空白だけ）と101文字は違反", () => {
    expect(BackgroundPhoto.violationsOfDescription("  ")).toHaveLength(1);
    expect(BackgroundPhoto.violationsOfDescription("あ".repeat(101))).toEqual(["説明文は100文字までです（101文字）"]);
  });

  it("AC-006-04 説明文はコードポイントで数える（絵文字100個はよい、101個は違反）", () => {
    expect(BackgroundPhoto.violationsOfDescription("😀".repeat(100))).toEqual([]);
    expect(BackgroundPhoto.violationsOfDescription("😀".repeat(101))).toEqual(["説明文は100文字までです（101文字）"]);
  });

  it("BR-006-04 改行・タブ・その他の制御文字・行区切りを含む説明文は違反（AI に渡す写真の一覧が1行1枚で並ぶため）", () => {
    const issue = ["説明文に改行や制御文字は入れられません"];
    const bads = ["夕暮れ\nの京都", "夕暮れ\r\nの京都", "夕暮れ\tの京都", "夕暮れ\u0000の京都", "夕暮れ\u007fの京都", "夕暮れ\u0085の京都",
      `夕暮れ${LINE_SEPARATOR}の京都`, `夕暮れ${PARAGRAPH_SEPARATOR}の京都`, "夕暮れ\n"];
    for (const bad of bads) {
      expect(BackgroundPhoto.violationsOfDescription(bad), JSON.stringify(bad)).toEqual(issue);
    }
    expect(BackgroundPhoto.violationsOfDescription("夕暮れの京都御苑 やわらかい光　全角空白もよい")).toEqual([]);
  });

  it("AC-006-04 説明文は前後の空白を取り除いてから数える（先頭に空白1つ＋100文字はよい。空白だけは違反）", () => {
    expect(BackgroundPhoto.violationsOfDescription(` ${"あ".repeat(100)}`)).toEqual([]);
    expect(BackgroundPhoto.violationsOfDescription(`${"あ".repeat(100)}　`)).toEqual([]);
    expect(BackgroundPhoto.violationsOfDescription(` ${"あ".repeat(101)}`)).toEqual(["説明文は100文字までです（101文字）"]);
    expect(BackgroundPhoto.violationsOfDescription(" 　 ")).toHaveLength(1);
  });

  it("AC-006-04 記録から戻すときは説明文を検査しない（過去に登録された、制御文字や101文字以上の説明文の写真も読み込める）", () => {
    for (const description of ["a\nb", "夕暮れ\tの京都", `夕暮れ${LINE_SEPARATOR}の京都`, "あ".repeat(150), ""]) {
      const restored = BackgroundPhoto.restore({ id: "x", storagePath: "p", description, origin: BackgroundPhotoOrigin.REGISTERED });
      expect(restored.description).toBe(description);
    }
    expect(BackgroundPhotoList.of([BackgroundPhoto.restore({ id: "x", storagePath: "p", description: "a\nb", origin: BackgroundPhotoOrigin.GENERATED })]).count()).toBe(1);
  });
});

describe("説明文の初めの値（BackgroundPhoto.initialDescription。BR-006-04）", () => {
  it("AC-006-04 1行の指示はそのまま", () => {
    expect(BackgroundPhoto.initialDescription("夕暮れの京都御苑、やわらかい光")).toBe("夕暮れの京都御苑、やわらかい光");
  });

  it("AC-006-04 複数行の指示は、改行・連続する空白を1つの空白にまとめる", () => {
    expect(BackgroundPhoto.initialDescription("夕暮れの京都御苑\nやわらかい光\r\n\r\n  青い空　　と雲\t雲")).toBe("夕暮れの京都御苑 やわらかい光 青い空 と雲 雲");
  });

  it("AC-006-04 行の区切りなど説明文に入れられない文字も空白にまとめ、前後の空白・改行は取り除く", () => {
    expect(BackgroundPhoto.initialDescription(`\n  桜並木${LINE_SEPARATOR}の${PARAGRAPH_SEPARATOR}道\u0000だ  \n`)).toBe("桜並木 の 道 だ");
  });

  it("AC-006-04 101文字以上の指示は、先頭100文字に切る（切ったあとの説明文は検査を通る）", () => {
    const cut = BackgroundPhoto.initialDescription("あ".repeat(101));
    expect([...cut]).toHaveLength(100);
    expect(BackgroundPhoto.violationsOfDescription(cut)).toEqual([]);
    expect(BackgroundPhoto.initialDescription("あ".repeat(100))).toBe("あ".repeat(100));
  });

  it("AC-006-04 コードポイントで切る（サロゲートペアの絵文字を途中で割らない）", () => {
    const cut = BackgroundPhoto.initialDescription("😀".repeat(150));
    expect([...cut]).toHaveLength(100);
    expect(cut).toBe("😀".repeat(100));
  });

  it("AC-006-04 AC-006-05 切った位置が空白でも、末尾の空白は残さない。500文字の指示（上限）でも検査を通る説明文になる", () => {
    expect(BackgroundPhoto.initialDescription(`${"あ".repeat(99)} いう`)).toBe("あ".repeat(99));
    const long = BackgroundPhoto.initialDescription(`${"夕暮れ\n".repeat(200)}`);
    expect(BackgroundPhoto.violationsOfDescription(long)).toEqual([]);
    expect([...long].length).toBeLessThanOrEqual(100);
  });
});

describe("背景写真の出どころ（BackgroundPhotoOrigin。採用の記録があるかから導く）", () => {
  it("AC-006-04 採用の記録があれば AI が作った背景、無ければ管理者の登録", () => {
    expect(BackgroundPhotoOrigin.ofAdoption(true)).toBe(BackgroundPhotoOrigin.GENERATED);
    expect(BackgroundPhotoOrigin.ofAdoption(false)).toBe(BackgroundPhotoOrigin.REGISTERED);
    expect(BackgroundPhotoOrigin.all().map((o) => o.code)).toEqual(["REGISTERED", "GENERATED"]);
    expect(BackgroundPhotoOrigin.from("GENERATED").isGenerated()).toBe(true);
    expect(() => BackgroundPhotoOrigin.from("OTHER")).toThrow("知らない背景写真の出どころ");
    expect(photo(1).isGenerated()).toBe(false);
    expect(photo(1, BackgroundPhotoOrigin.GENERATED).isGenerated()).toBe(true);
    expect(photo(1, BackgroundPhotoOrigin.GENERATED).origin.label).toBe("AIが作った背景");
  });
});

describe("AI が作った背景だけの投稿のAI生成の表示（BR-006-03。AC-006-13）", () => {
  it("AC-006-13 AI が作った背景を表紙の背景にしても、AI生成の表示も承認時の確認も要らない（背景・イラストだけを作る）", () => {
    const generated = photo(1, BackgroundPhotoOrigin.GENERATED);
    const slides = SlideList.of([
      Slide.createCover(CoverContent.of(sampleCoverText(), { photoId: generated.id, storagePath: generated.storagePath })),
      Slide.createBody(sampleBody()), Slide.createClosing(ClosingContent.empty()),
    ]);
    expect(generated.isGenerated()).toBe(true);
    expect(slides.imageRefs()).toEqual([generated.storagePath]);
    expect(slides.requiresAiDisclosure()).toBe(false);
    expect(slides.needsApprovalCheck()).toBe(false);
  });
});
