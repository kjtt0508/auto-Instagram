# 管理画面（frontend）

新島info の Instagram 予約投稿の管理画面。Next.js の静的出力を Cloudflare Pages で配信し、
データはブラウザから Supabase（RLS・RPC）で読み書きする（ADR-0002）。秘密情報が要る処理（Instagram 連携の OAuth）だけを Pages Functions に置く。

| ディレクトリ | レイヤ | 中身 |
|---|---|---|
| `src/domain/` | domain | 投稿・ロール・警告などの業務ルール（`docs/model/domain.yaml` の用語）。Java と同じルールは `docs/model/fixtures/*.json` を共通のテストケースにする（ADR-0005） |
| `src/lib/api/` | application | Supabase の読み取りと RPC 呼び出し |
| `src/app/`, `src/components/` | presentation | 画面（S-01〜S-04, S-11） |
| `server/` | API関数の中身 | Instagram 連携（`connection/application` がユースケース、`infrastructure` が Supabase・Instagram・暗号化） |
| `functions/api/[[route]].ts` | 入口 | Pages Functions。`/api/*` を Hono に渡す |

## コマンド

```sh
npm run dev        # 開発サーバー（.env.local に NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY）
npm run test       # 単体テスト（Vitest）
npm run e2e        # E2E（Playwright。Supabase は差し替え、スマホ幅 375px）
npm run build      # 静的出力（out/）
npx wrangler pages functions build   # API関数のバンドル確認
```

API関数の環境変数（Cloudflare の Secret）: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TOKEN_ENC_KEY_V1`,
`IG_APP_ID`, `IG_APP_SECRET`, `IG_REDIRECT_URI`, `IG_API_VERSION`。値はファイルに書かない。
