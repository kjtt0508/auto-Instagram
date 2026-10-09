import { describe, expect, it } from "vitest";
import { SAMPLE_TEMPLATE_VERSION, sampleBody, sampleMaterial, sampleSettings, sampleSlides } from "../__tests__/samples";
import { Caption } from "../post/Caption";
import { PostRevision } from "../post/PostRevision";
import { PrCategory } from "../post/PrCategory";
import { SlideList } from "../slide/SlideList";
import { SlideRole } from "../slide/SlideRole";
import { DraftProposal } from "./DraftProposal";
import { PromptPurpose } from "./PromptPurpose";

const context = (sourceUrlRequired = false) => ({ settings: sampleSettings(), prLabel: "【PR】\n", sourceUrlRequired });

const slideJson = (n: number, overrides: Record<string, unknown> = {}) => ({
  heading: `見出し${n}`, description: `説明文${n}です。学割が使えます。`, emphases: ["学割"],
  picturePrompt: "明るい雰囲気のカフェの背景", needsReplacement: false, ...overrides,
});

const draftJson = (overrides: Record<string, unknown> = {}) => ({
  cover: { target: "同志社大学", keyword: "期末試験", annotation: "＼ 日程発表 ／", closingWords: "まとめたよ", accent: "PURPLE" },
  backgroundPhotoId: "bg1",
  slides: [slideJson(1), slideJson(2), slideJson(3)],
  caption: "期末試験の日程をまとめました😀\n\n早めに確認しておきましょう。",
  additionalHashtags: ["#学割", "#京都"], prCategory: "NONE", sourceUrls: [], ...overrides,
});

const withCover = (cover: Record<string, unknown>) => draftJson({ cover: { ...draftJson().cover, ...cover } });
const violationsOf = (json: unknown, sourceUrlRequired = false) => DraftProposal.parse(json, context(sourceUrlRequired)).violations;

describe("下書き案を出力 JSON から作る", () => {
  it("AC-002-03 スキーマどおりの出力は、表紙・中のスライド3枚・キャプション・追加のハッシュタグ2個の下書き案になる", () => {
    const { proposal, violations } = DraftProposal.parse(draftJson(), context());
    expect(violations).toEqual([]);
    expect(proposal?.cover.keyword).toBe("期末試験");
    expect(proposal?.bodies().map((b) => b.text.heading)).toEqual(["見出し1", "見出し2", "見出し3"]);
    expect(proposal?.additionalHashtags).toEqual(["#学割", "#京都"]);
    expect(proposal?.backgroundPhotoId).toBe("bg1");
  });

  it("AC-002-03 下書き案から作ったスライド構成は 表紙 → 中のスライド3枚 → 最後のスライド の順", () => {
    const proposal = DraftProposal.parse(draftJson(), context()).proposal!;
    const slides = SlideList.createFromDraft(proposal).items();
    expect(slides.map((s) => s.role)).toEqual([SlideRole.COVER, SlideRole.BODY, SlideRole.BODY, SlideRole.BODY, SlideRole.CLOSING]);
  });

  it("AC-002-11 キーワード12文字・締めの言葉8文字は受け付ける", () => {
    expect(violationsOf(withCover({ keyword: "あ".repeat(12), closingWords: "い".repeat(8) }))).toEqual([]);
  });

  it("AC-002-11 キーワード13文字・締めの言葉9文字・対象「同志社」・色「緑」は違反（下書き案にならない）", () => {
    expect(violationsOf(withCover({ keyword: "あ".repeat(13) }))).toEqual(["キーワードは1〜12文字にしてください（13文字）"]);
    expect(violationsOf(withCover({ closingWords: "い".repeat(9) }))).toEqual(["締めの言葉は1〜8文字にしてください（9文字）"]);
    expect(violationsOf(withCover({ target: "同志社" }))).toEqual(["対象は「同志社大学」「同志社大生」のどれかにしてください"]);
    expect(violationsOf(withCover({ accent: "緑" }))).toEqual(["帯の色は紫・赤・青緑のどれかにしてください"]);
    expect(DraftProposal.parse(withCover({ accent: "緑" }), context()).proposal).toBeUndefined();
  });

  it("AC-002-12 説明文120文字・強調する語3か所は受け付ける", () => {
    expect(violationsOf(draftJson({ slides: [slideJson(1, { description: "あ".repeat(120), emphases: [] })] }))).toEqual([]);
    expect(violationsOf(draftJson({ slides: [slideJson(1, { description: "学割と学生証と京都", emphases: ["学割", "学生証", "京都"] })] }))).toEqual([]);
  });

  it("AC-002-12 説明文121文字・強調4か所・説明文に無い語・重なる指定は違反で、何枚目かを添える", () => {
    const slides = (overrides: Record<string, unknown>) => draftJson({ slides: [slideJson(1), slideJson(2, overrides)] });
    expect(violationsOf(slides({ description: "あ".repeat(121), emphases: [] }))).toEqual(["中のスライド2枚目: 説明文は1〜120文字にしてください（121文字）"]);
    expect(violationsOf(slides({ description: "あいうえお", emphases: ["あ", "い", "う", "え"] })))
      .toEqual(["中のスライド2枚目: 強調する語は3か所までです（4か所）"]);
    expect(violationsOf(slides({ description: "学割を使おう", emphases: ["全額"] })))
      .toEqual(["中のスライド2枚目: 強調する語「全額」が説明文にありません"]);
    expect(violationsOf(slides({ description: "学割を使おう", emphases: ["学割を", "割を使"] })))
      .toEqual(["中のスライド2枚目: 強調する語「割を使」が他の強調する語と重なっています"]);
  });

  it("BR-002-11 中のスライドが0枚・9枚の出力は違反", () => {
    expect(violationsOf(draftJson({ slides: [] }))).toEqual(["中のスライドは1〜8枚にしてください（0枚）"]);
    const nine = Array.from({ length: 9 }, (_, i) => slideJson(i + 1));
    expect(violationsOf(draftJson({ slides: nine }))).toEqual(["中のスライドは1〜8枚にしてください（9枚）"]);
    expect(violationsOf(draftJson({ slides: nine.slice(0, 8) }))).toEqual([]);
  });

  it("BR-002-03 追加のハッシュタグは5個まで。ハッシュタグの形でないものは違反", () => {
    expect(violationsOf(draftJson({ additionalHashtags: ["#a", "#b", "#c", "#d", "#e"] }))).toEqual([]);
    expect(violationsOf(draftJson({ additionalHashtags: ["#a", "#b", "#c", "#d", "#e", "#f"] })))
      .toEqual(["追加のハッシュタグは5個までです（6個）"]);
    expect(violationsOf(draftJson({ additionalHashtags: ["学割"] }))).toEqual(["ハッシュタグの形が正しくありません: 学割"]);
  });

  it("BR-002-16 AC-002-18 キャプション本文は、AI生成の表示の18文字を常に見込んだ残りの文字数に収まる", () => {
    // 見込む付記: AI生成の表示18 + 定型71（前に空行2）+ ハッシュタグ19（前に空行2）= 112 → 2088
    expect(violationsOf(draftJson({ caption: "あ".repeat(2088) }))).toEqual([]);
    expect(violationsOf(draftJson({ caption: "あ".repeat(2089) }))[0]).toContain("キャプション本文は2,088文字以内にしてください（2,089文字");
    // PR案件はPR表記の5文字ぶん減る
    expect(violationsOf(draftJson({ caption: "あ".repeat(2083), prCategory: "PR" }))).toEqual([]);
    expect(violationsOf(draftJson({ caption: "あ".repeat(2084), prCategory: "PR" }))[0]).toContain("2,083文字以内");
  });

  it("BR-002-16 本文のハッシュタグが混ざって合計30個を超える出力は違反", () => {
    const caption = Array.from({ length: 27 }, (_, i) => `#タグ${i}`).join(" ");
    expect(violationsOf(draftJson({ caption }))).toEqual(["ハッシュタグは30個までです（31個）"]);
  });

  it("参照元URLは、ネタの出どころがニュースなら1件以上要る。URLの形でないものは違反", () => {
    expect(violationsOf(draftJson(), true)).toEqual(["参照元URLが1件以上必要です"]);
    expect(violationsOf(draftJson({ sourceUrls: ["https://example.com/news/1"] }), true)).toEqual([]);
    expect(violationsOf(draftJson({ sourceUrls: ["example.com"] }))).toEqual(["参照元URLの形が正しくありません: example.com"]);
  });

  it("BR-002-03 PR区分は NONE か PR。それ以外は違反", () => {
    expect(violationsOf(draftJson({ prCategory: "AD" }))).toEqual(["PR区分は NONE か PR で指定してください"]);
  });

  it("BR-002-03 スキーマに合わない出力（項目の欠け・型違い）は場所を添えた違反になる", () => {
    expect(violationsOf("{}")).toContain("出力 はオブジェクトで指定してください");
    const broken = draftJson({ caption: 1, slides: [{ heading: 1 }] });
    expect(violationsOf(broken)).toEqual(expect.arrayContaining([
      "caption は文字列で指定してください", "slides[0].heading は文字列で指定してください", "slides[0].description は文字列で指定してください"]));
    expect(violationsOf({ ...draftJson(), cover: undefined })).toContain("cover はオブジェクトで指定してください");
  });

  it("AC-002-21 差し替えが必要の印は絵の指示と一緒に保たれる", () => {
    const json = draftJson({ slides: [slideJson(1, { picturePrompt: "音楽アプリの料金表のイメージ", needsReplacement: true })] });
    const brief = DraftProposal.parse(json, context()).proposal!.bodies()[0].brief;
    expect(brief.needsReplacement()).toBe(true);
    expect(brief.promptText()).not.toContain("Spotify");
  });

  it("AC-002-20 個人情報を含む絵の指示は違反", () => {
    const json = draftJson({ slides: [slideJson(1, { picturePrompt: "連絡先 taro@example.com の画像" })] });
    expect(violationsOf(json)).toEqual(["中のスライド1枚目: 絵の指示: 個人を特定できる情報は指示に含められません"]);
  });
});

describe("ネタに無い情報（UNSUPPORTED_FACT。AC-002-13）", () => {
  const proposalWith = (description: string, caption = "本文です") =>
    DraftProposal.parse(draftJson({ slides: [slideJson(1, { description, emphases: [] })], caption }), context()).proposal!;

  it("AC-002-13 ネタに日付が無いのに説明文に「11/3」があれば、その説明文の「11/3」に注意が出る", () => {
    expect(proposalWith("試験は11/3に行われます").unsupportedFacts("期末試験についてのメモ"))
      .toEqual([{ location: "slides[0].description", fact: "11/3" }]);
  });

  it("AC-002-13 ネタにある日付・金額・時刻・URL には注意が出ない（表記ゆれを揃えて比べる）", () => {
    const idea = "11月3日 10:00 から。参加費は1000円。https://example.com/info";
    expect(proposalWith("11/3の１０時に集合。¥1,000です。https://example.com/info/").unsupportedFacts(idea)).toEqual([]);
    expect(proposalWith("１１月３日の10:00から").unsupportedFacts(idea)).toEqual([]);
    expect(proposalWith("参加費は１，０００円").unsupportedFacts(idea)).toEqual([]);
  });

  it("AC-002-13 ネタに無い金額・時刻・URL・日付は、場所とともにすべて見つかる。キャプション本文も調べる", () => {
    const facts = proposalWith("参加費は2000円です。9時30分から", "詳しくは https://example.org/x と2026年12月1日の告知で")
      .unsupportedFacts("参加費は1000円");
    expect(facts).toEqual([
      { location: "slides[0].description", fact: "9時30分" },
      { location: "slides[0].description", fact: "2000円" },
      { location: "caption", fact: "https://example.org/x" },
      { location: "caption", fact: "2026年12月1日" },
    ]);
  });

  it("URL の中の数字やスラッシュを日付・金額と読み違えない", () => {
    expect(proposalWith("https://example.com/2026/11/3/1000 を見てね").unsupportedFacts("https://example.com/2026/11/3/1000"))
      .toEqual([]);
    expect(proposalWith("https://example.com/2026/11/3 を見てね").unsupportedFacts("https://example.com/other"))
      .toEqual([{ location: "slides[0].description", fact: "https://example.com/2026/11/3" }]);
  });

  it("「1万円」は「10000円」と同じ金額", () => {
    expect(proposalWith("参加費は1万円").unsupportedFacts("参加費は10,000円")).toEqual([]);
  });
});

describe("投稿の版への文言の取り込み（修正指示の再生成）", () => {
  const revisionOf = (prCategory: PrCategory) => PostRevision.ofSlides({
    caption: Caption.of("元の本文"), prCategory, slides: sampleSlides([sampleBody(sampleMaterial("ILLUSTRATION"))]),
    templateVersion: SAMPLE_TEMPLATE_VERSION, settings: sampleSettings(), additionalHashtags: ["#元"],
  });

  it("BR-002-04 人が設定したPR区分は、下書き案のPR区分が違っても修正で変わらない", () => {
    const prDraft = DraftProposal.parse(draftJson({ prCategory: "PR" }), context()).proposal!;
    expect(revisionOf(PrCategory.NONE).withDraftText(prDraft).prCategory).toBe(PrCategory.NONE);
    const noneDraft = DraftProposal.parse(draftJson({ prCategory: "NONE" }), context()).proposal!;
    expect(revisionOf(PrCategory.PR).withDraftText(noneDraft).prCategory).toBe(PrCategory.PR);
  });

  it("AC-002-05 キャプションと追加のハッシュタグは新しい文言になり、素材画像は保たれる", () => {
    const draft = DraftProposal.parse(draftJson(), context()).proposal!;
    const after = revisionOf(PrCategory.NONE).withDraftText(draft);
    expect(after.caption.text).toBe(draft.caption.text);
    expect(after.publishCaption("【PR】\n").text).toContain("#学割\n#京都");
    expect(after.publishCaption("【PR】\n").text).not.toContain("#元");
    expect(after.imageRefs()).toContain("t/materials/1.jpg");
  });
});

describe("文言だけの取り込み（修正指示の再生成。AC-002-05）", () => {
  it("AC-002-05 文言だけが新しくなり、素材画像と選び直した背景写真は保たれる", () => {
    const proposal = DraftProposal.parse(draftJson(), context()).proposal!;
    const before = sampleSlides([sampleBody(), sampleBody(sampleMaterial("ILLUSTRATION"))]);
    const after = before.withDraftText(proposal);
    expect(after.count()).toBe(5);
    expect(after.items()[0].coverContent()?.text.keyword).toBe("期末試験");
    expect(after.items()[0].coverContent()?.background?.photoId).toBe("bg1");
    expect(after.items()[2].bodyContent()?.material?.storagePath).toBe("t/materials/1.jpg");
    expect(after.items()[2].bodyContent()?.text.heading).toBe("見出し2");
    expect(after.items()[3].bodyContent()?.material).toBeUndefined();
  });
});

describe("修正の現在の下書き（current）の読み方", () => {
  it("AC-002-05 知らない欄は捨てて、下書き案の形に整える", () => {
    const read = DraftProposal.readCurrent({ ...draftJson(), evil: "x", cover: { ...draftJson().cover, extra: 1 } });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(Object.keys(read.draft).sort()).toEqual(["additionalHashtags", "caption", "cover", "prCategory", "slides", "sourceUrls"]);
    expect(Object.keys(read.draft.cover as object)).not.toContain("extra");
    expect(read.keep).toEqual({ bodySlideCount: 3, prCategory: "NONE", sourceUrls: [] });
  });

  it("AC-002-05 文字数の違反は受け付ける（画面で赤字のままでも作り直せる）", () => {
    expect(DraftProposal.readCurrent(withCover({ keyword: "あ".repeat(40) })).ok).toBe(true);
  });

  it("AC-002-05 JSON で32,768文字を超える巨大な値は受け付けない", () => {
    const huge = draftJson({ caption: "あ".repeat(DraftProposal.CURRENT_MAX_LENGTH) });
    const read = DraftProposal.readCurrent(huge);
    expect(read.ok).toBe(false);
  });

  it("AC-002-05 形が違う・中のスライドが範囲外・PR区分が不正なら受け付けない", () => {
    expect(DraftProposal.readCurrent("x").ok).toBe(false);
    expect(DraftProposal.readCurrent(draftJson({ slides: [] })).ok).toBe(false);
    expect(DraftProposal.readCurrent(draftJson({ prCategory: "AD" })).ok).toBe(false);
    expect(DraftProposal.readCurrent(draftJson({ caption: 1 })).ok).toBe(false);
  });
});

describe("用途ごとの業務ルール", () => {
  const keep = { bodySlideCount: 3, prCategory: "NONE", sourceUrls: ["https://example.com/a"] };

  it("AC-002-05 修正では PR区分・参照元URLを保ち、背景写真は変えない", () => {
    const { proposal, violations } = DraftProposal.parse(draftJson({ prCategory: "PR", sourceUrls: [] }),
      { ...context(), purpose: PromptPurpose.REVISE, keep });
    expect(violations).toEqual([]);
    expect(proposal?.prCategory).toBe(PrCategory.NONE);
    expect(proposal?.sourceUrls).toEqual(["https://example.com/a"]);
    expect(proposal?.backgroundPhotoId).toBeUndefined();
  });

  it("AC-002-05 修正で中のスライドの枚数が変わったら違反", () => {
    expect(DraftProposal.parse(draftJson({ slides: [slideJson(1)] }), { ...context(), purpose: PromptPurpose.REVISE, keep }).violations)
      .toEqual(["中のスライドは3枚にしてください（1枚）"]);
  });

  it("AC-002-03 最初の生成では、候補に無い背景写真は違反、候補が0件なら捨てる", () => {
    expect(DraftProposal.parse(draftJson(), { ...context(), backgroundPhotoIds: ["other"] }).violations)
      .toEqual(["背景写真のIDが候補にありません: bg1"]);
    expect(DraftProposal.parse(draftJson(), { ...context(), backgroundPhotoIds: [] }).proposal?.backgroundPhotoId).toBeUndefined();
    expect(DraftProposal.parse(draftJson(), { ...context(), backgroundPhotoIds: ["bg1"] }).violations).toEqual([]);
  });
});
