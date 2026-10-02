# ADR-0002: 管理画面は Next.js の静的出力＋Cloudflare Pages Functions にする

- 状態: 提案
- 日付: 2026-10-01
- 関連: REQ-001, REQ-002 / 原則 P16

## 背景
要件7章は「Next.js（App Router）、Cloudflare Pages / Workers で配信」。Next.js をサーバーとして
Workers で動かす（OpenNext）と、無料プランの1リクエストあたり CPU 時間（10ms）とバンドルサイズ（圧縮後3MB）の上限に当たりやすい。

## 決定
- Next.js は `output: 'export'` の静的出力にし、Cloudflare Pages で配信する（静的配信は無料・無制限）。
- データの読み書きは、ブラウザから supabase-js で RLS の範囲内で行う。
- 秘密情報が必要な処理（Gemini、Instagram OAuth、PR入稿の受付）だけを Pages Functions（Hono）に置く。

## 検討した代替案
- OpenNext で Next.js をそのまま Workers に載せる: Server Actions が使えて書きやすいが、無料枠の上限に当たる危険がある。
- Vercel Hobby: 無料だが商用利用不可のため、京愛の事業としての提供に合わない。

## 結果
- 静的出力ではビルド時に分からない動的ルート（`/posts/[id]`）を作れないため、個別の画面はクエリ文字列で表す（例 `/posts/view?id=…`）。
- Server Components / Server Actions は使わない。画面のドメインロジックは TS のドメイン層に置き、ブラウザで実行する。
- 認可の正は RLS になる（画面の出し分けは補助）。RLS のテストを厚くする。
- 未決: Gemini 呼び出し（待ち時間30秒程度）が Pages Functions 無料枠で問題なく動くか、フェーズ0で確認する。
