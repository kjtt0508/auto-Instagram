"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, CellButton } from "@/components/ui/Button";
import { GroupedSection } from "@/components/ui/Grouped";
import type { Role } from "@/domain/member/Role";
import type { Post } from "@/domain/post/Post";
import { cancelSchedule, discard, requestApproval, returnToDraft, sendBackToDraft } from "@/lib/api/postCommands";
import { ApproveForm } from "./ApproveForm";
import { RetryForm } from "./RetryForm";

/** S-04 の操作。どのボタンを出すかは Post（状態×ロール）が決める。認可の正は RPC */
export function PostActions({ post, role, prLabel, onChanged }: { post: Post; role: Role; prLabel: string; onChanged: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const run = (command: () => Promise<void>) => command().then(onChanged, (e: Error) => setError(e.message));
  const hasSecondary = post.canEdit() || post.canSendBack(role) || post.canCancelSchedule(role)
    || post.canReturnToDraft(role) || post.canDiscard(role) || post.outcome.result !== null;

  return (
    <>
      {post.canApprove(role) && <ApproveForm post={post} onDone={onChanged} />}
      {post.canRetry(role) && <GroupedSection title="再実行"><div className="p-3"><RetryForm postId={post.id} onDone={onChanged} /></div></GroupedSection>}
      {post.canRequestApproval() && (
        <div className="mt-6"><Button variant="filled" block onClick={() => requestWithCheck(post, prLabel, setError, onChanged)}>承認を依頼</Button></div>
      )}
      {hasSecondary && (
        <GroupedSection label="操作">
          {post.canEdit() && <Link href={`/posts/edit/?id=${encodeURIComponent(post.id)}`} className="block min-h-11 px-4 py-2.5 text-center text-tint active:bg-fill">編集</Link>}
          {post.canSendBack(role) && <Row><CellButton onClick={() => run(() => sendBackToDraft(post.id))}>下書きに戻す</CellButton></Row>}
          {post.canCancelSchedule(role) && <Row><CellButton onClick={() => run(() => cancelSchedule(post.id))}>予約を取り消す</CellButton></Row>}
          {post.canReturnToDraft(role) && <Row><CellButton onClick={() => run(() => returnToDraft(post.id))}>下書きに戻す</CellButton></Row>}
          {post.outcome.result && (
            <Row><a href={post.outcome.result.permalink} target="_blank" rel="noreferrer" className="block min-h-11 px-4 py-2.5 text-center text-tint">Instagramで見る</a></Row>
          )}
          {post.canDiscard(role) && (
            <Row><CellButton variant="destructive" onClick={() => discard(post.id).then(() => router.push("/"), (e: Error) => setError(e.message))}>破棄</CellButton></Row>
          )}
        </GroupedSection>
      )}
      {error && <p role="alert" className="whitespace-pre-line px-4 pt-2 text-[13px] text-destructive">{error}</p>}
    </>
  );
}

/** 2つ目以降の操作の上に区切り線を引く */
function Row({ children }: { children: React.ReactNode }) {
  return <div className="border-separator [:not(:first-child)]:border-t">{children}</div>;
}

/** 承認依頼の前に、枚数・画像・文字数（PR表記込み）を確かめる（AC-001-07〜09） */
function requestWithCheck(post: Post, prLabel: string, setError: (m: string) => void, onDone: () => void) {
  const violations = post.violationsBeforeApprovalRequest(prLabel);
  if (violations.length > 0) return setError(violations.join("\n"));
  requestApproval(post.id, post.content.revisionId).then(onDone, (e: Error) => setError(e.message));
}
