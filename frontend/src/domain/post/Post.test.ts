import { describe, expect, it } from "vitest";
import { Role } from "../member/Role";
import { Caption } from "./Caption";
import { FailureReason } from "./FailureReason";
import { Post } from "./Post";
import { PostFormat } from "./PostFormat";
import { PostMedia } from "./PostMedia";
import { PostMediaList } from "./PostMediaList";
import { PostStatus } from "./PostStatus";
import { PrCategory } from "./PrCategory";

const PR_LABEL = "【PR】\n";
const mediaList = (count: number) => PostMediaList.of(Array.from({ length: count }, (_, i) =>
  PostMedia.of({ position: i + 1, storagePath: `t/posts/${i}.jpg`, width: 1080, height: 1350, bytes: 500_000 })));
const post = (status: PostStatus) => Post.restore({
  id: "p1", status,
  content: { revisionId: "r1", format: PostFormat.FEED_IMAGE, caption: Caption.of("本文"), prCategory: PrCategory.PR,
    media: mediaList(1), genreId: null },
  outcome: { scheduledAt: null, result: null,
    failure: status.isFailed() ? FailureReason.of("TOKEN_INVALID", "トークンが無効です") : null },
});

describe("承認依頼の前の検査", () => {
  const request = (count: number, captionText: string, prCategory = PrCategory.NONE) =>
    Post.violationsForApprovalRequest({ format: PostFormat.CAROUSEL, media: mediaList(count), captionText, prCategory }, PR_LABEL);

  it("AC-001-07 カルーセル1枚と11枚は拒否、2枚と10枚は受け付ける", () => {
    expect(request(1, "本文")).toEqual(["カルーセルは2〜10枚です"]);
    expect(request(11, "本文")).toEqual(["カルーセルは2〜10枚です"]);
    expect(request(2, "本文")).toEqual([]);
    expect(request(10, "本文")).toEqual([]);
  });

  it("AC-001-09 PR案件2,196文字はPR表記込みの文字数で拒否", () => {
    expect(request(2, "あ".repeat(2196), PrCategory.PR)).toEqual(["PR表記を含めて2,200文字以内にしてください（2,201文字）"]);
  });

  it("AC-001-08 キャプションの不備も並べて出す", () => {
    expect(request(2, "あ".repeat(2201))).toEqual(["キャプションは2,200文字以内です（2,201文字）"]);
  });
});

describe("操作できるか（状態×ロール。REQ-001 設計 S-04）", () => {
  it("AC-001-10 編集者は承認待ちの投稿を予約に確定できない", () => {
    expect(post(PostStatus.AWAITING_APPROVAL).canApprove(Role.EDITOR)).toBe(false);
    expect(post(PostStatus.AWAITING_APPROVAL).canApprove(Role.APPROVER)).toBe(true);
  });

  it("AC-001-18 AC-001-22 失敗した投稿は承認者が再実行・下書きに戻す・破棄できる", () => {
    const failed = post(PostStatus.FAILED);
    expect([failed.canRetry(Role.APPROVER), failed.canReturnToDraft(Role.APPROVER), failed.canDiscard(Role.APPROVER)])
      .toEqual([true, true, true]);
    expect([failed.canRetry(Role.EDITOR), failed.canDiscard(Role.EDITOR)]).toEqual([false, false]);
    expect(failed.outcome.failure?.guidance()).toContain("連携をやり直して");
  });

  it("下書きは全ロールが編集・承認依頼・破棄できる", () => {
    const draft = post(PostStatus.DRAFT);
    expect([draft.canEdit(), draft.canRequestApproval(), draft.canDiscard(Role.EDITOR)]).toEqual([true, true, true]);
  });

  it("予約中は承認者が取り消せる。公開済み・公開処理中は何もできない", () => {
    expect(post(PostStatus.SCHEDULED).canCancelSchedule(Role.APPROVER)).toBe(true);
    expect(post(PostStatus.SCHEDULED).canCancelSchedule(Role.EDITOR)).toBe(false);
    for (const status of [PostStatus.PUBLISHING, PostStatus.PUBLISHED]) {
      const p = post(status);
      expect([p.canEdit(), p.canApprove(Role.ADMIN), p.canRetry(Role.ADMIN), p.canDiscard(Role.ADMIN)])
        .toEqual([false, false, false, false]);
    }
  });

  it("公開用キャプションはPR表記付き", () => {
    expect(post(PostStatus.DRAFT).publishCaption(PR_LABEL).text).toBe("【PR】\n本文");
  });
});
