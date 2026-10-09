"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { formatDateTime } from "@/components/format";
import { MediaPreview } from "@/components/post/MediaPreview";
import { PostActions } from "@/components/post/PostActions";
import { SlidePreview } from "@/components/post/SlidePreview";
import { StatusBadge } from "@/components/post/StatusBadge";
import { useSession } from "@/components/session/SessionGate";
import { Cell, GroupedSection, LargeTitle, Placeholder, ValueCell } from "@/components/ui/Grouped";
import type { Post } from "@/domain/post/Post";
import type { PostEvent } from "@/domain/post/PostEvent";
import { findPost, postHistory } from "@/lib/api/postRepository";

/** S-04 投稿詳細（/posts/view/?id=…。静的出力のため動的ルートは使わない。ADR-0002） */
export default function PostViewPage() {
  return (
    <>
      <LargeTitle>投稿</LargeTitle>
      <Suspense fallback={<Placeholder>読み込み中…</Placeholder>}><PostView /></Suspense>
    </>
  );
}

function PostView() {
  const id = useSearchParams().get("id") ?? "";
  const { member, tenant } = useSession();
  const [loaded, setLoaded] = useState<{ post: Post | null; history: PostEvent[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    Promise.all([findPost(id), postHistory(id)]).then(([post, history]) => setLoaded({ post, history }), (e: Error) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);

  if (error) return <Placeholder tone="error">{error}</Placeholder>;
  if (!loaded) return <Placeholder>読み込み中…</Placeholder>;
  if (!loaded.post) return <Placeholder>投稿が見つかりません</Placeholder>;
  const post = loaded.post;
  return (
    <article>
      {post.content.template
        ? <SlidePreview slides={post.content.template.slides} settings={post.content.template.settings}
            templateVersion={post.content.template.templateVersion} closingNote="過去の投稿は承認した時点の新しい2件が入ります" />
        : <MediaPreview media={post.content.media} />}
      <StatusSection post={post} />
      <GroupedSection title="キャプション（公開される文面）">
        <Cell><p className="whitespace-pre-wrap break-words text-[15px]">{post.publishCaption(tenant.prLabel).text}</p></Cell>
      </GroupedSection>
      <PostActions post={post} role={member.role} prLabel={tenant.prLabel} onChanged={load} />
      <History events={loaded.history} />
    </article>
  );
}

function StatusSection({ post }: { post: Post }) {
  const { scheduledAt, failure } = post.outcome;
  return (
    <GroupedSection title="状態" footer={failure && <span className="text-destructive">{failure.message}<br />{failure.guidance()}</span>}>
      <ValueCell label="状態"><StatusBadge status={post.status} /></ValueCell>
      <ValueCell label="種別">{post.content.format.label}・{post.content.prCategory.label}</ValueCell>
      {scheduledAt && <ValueCell label="予約日時">{formatDateTime(scheduledAt.toDate())}</ValueCell>}
    </GroupedSection>
  );
}

function History({ events }: { events: readonly PostEvent[] }) {
  if (events.length === 0) return null;
  return (
    <GroupedSection title="履歴">
      {events.map((e, i) => (
        <Cell key={i}>
          <p className="text-[15px]">{e.kindLabel}<span className="text-secondary-label">・{e.actorText()}</span></p>
          <p className="text-[13px] text-secondary-label">{formatDateTime(e.occurredAt)}{e.detail.note && `　${e.detail.note}`}</p>
        </Cell>
      ))}
    </GroupedSection>
  );
}
