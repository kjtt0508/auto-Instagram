# ADR-0003: Instagram API は「Instagramログイン」方式を使う

- 状態: 提案（フェーズ0のテスト投稿で確定）
- 日付: 2026-10-01
- 関連: REQ-001（BR-001-02）

## 背景
Instagram への投稿 API には、Facebook ページを介する方式（Facebook ログイン）と、Instagram のアカウントで直接連携する方式（Instagram ログイン）がある。
新島info は Facebook ページを運用していない可能性があり、運営は技術に詳しくない学生。

## 決定
- Instagram ログイン方式（`graph.instagram.com`）を使う。必要なのはビジネス／クリエイターアカウントへの切り替えだけ。
- Meta 開発者アプリは京愛名義で作り、開発モードのまま新島infoのアカウントをテスターに登録して使う（App Review なし）。

## 検討した代替案
- Facebook ログイン方式: Facebook ページとの紐付けが必要で、運営の手間と説明が増える。

## 結果
- API クライアントは `InstagramClient` インターフェースの裏に置き、方式を変えても影響を infrastructure に閉じる。
- 未決: テスターとしての投稿・Insights 取得が、現行の仕様で可能か（フェーズ0のテスト投稿で確認）。
