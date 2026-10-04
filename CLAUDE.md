# CLAUDE.md

## 設計思想
このリポジトリは **ドメインモデル中心** で作る。業務の関心事をドメインオブジェクトに集め、画面・DB・外部API はその外側に置く。
判断基準は `docs/principles.md`（P01–P35）。作業ごとのスキル・エージェントの使い分けは `MANUAL.md`。書籍の各章との対応は `BOOK_COVERAGE.md`。指摘・コミット・ADR では原則IDを引用する（`python3 .claude/harness/harness.py explain P12` で要約表示）。

## このプロジェクトの構成
言語・レイヤの配置・ビルド/テスト手順は `harness.yaml` に定義されている（ハーネスの既定値は `.claude/harness/defaults.yaml`）。
レイヤはディレクトリ名で判定される: `domain` / `application`(usecase, service) / `presentation`(controller, web, handler, ui…) / `infrastructure`(infra, persistence, adapter…)。
新しいコードは、そのレイヤに対応するディレクトリに置くこと。

- `docs/requirements/REQ-xxx.yaml` 要件（業務の関心事・業務ルール・受入基準）
- `docs/model/domain.yaml` **用語集兼ドメインモデル（唯一の正）**
- `docs/design/REQ-xxx.md` 設計 / `docs/adr/` 設計判断 / `docs/releases/vX.Y.Z.md` リリースノート
- テンプレートは `.claude/harness/templates/`

## 工程（順序はフックが強制する）
| 工程 | スキル | 出力 | 完了条件 |
|---|---|---|---|
| 01 要件定義 | `/p1-req` | REQ-xxx.yaml | 関心事・業務ルール・受入基準が揃い、open_questions が空で approved |
| 02 ドメインモデル | `/p2-model` | domain.yaml | 業務ルールの用語がすべて定義され、kind・不変条件・振る舞いがある |
| 03 設計 | `/p3-design` | design/REQ-xxx.md, ADR | ユースケース・外部契約・永続化方針が決まっている |
| 04 実装 | `/p4-impl` | コード + ドメイン単体テスト | lint エラー 0 |
| 05 テスト | `/p5-test` | テスト | 全受入基準がテストに紐付く（`check --strict`） |
| 06 リリース | `/p6-release` | リリースノート, tag | `harness verify` が現 HEAD で成功 |

補助スキル: `/domain-discovery`（業務知識の引き出し・ヒト/モノ/コト）、`/ui-design`（画面）、`/api-design`（連携・API）、`/db-design`（テーブル・マイグレーション）、`/refactor`（既存コードの段階的改善）、`/project-management`（進捗・見積もり・ドキュメント方針）。

工程は戻ってよい。新しい言葉や曖昧さが出たら **コードより先に用語集・要件を直す**。
バグ修正・小さな改修も、既存の REQ に受入基準を追加するか、新しい REQ を切ってから行う。

## 絶対ルール
1. 用語集に無い概念の型を domain に作らない（フックが拒否する）。
2. フックに止められたら、ルールを回避せず指摘された原則に沿って直す。迷ったら理由を添えてユーザーに相談する。
3. ハーネス（`.claude/harness/`, `.claude/settings.json`, `harness.yaml`, `docs/principles.md`, CI）を変更しない。必要なら提案に留める。
4. テストや検査を弱めてグリーンにしない。`.harness-baseline.json` に新しい違反を追加しない。
5. 原則からの意図的な逸脱は ADR を `docs/adr/` に書いてから、該当箇所に `harness-allow: Pxx ADR-xxxx` とコメントする（ADR が実在しない例外は無効になりエラーになる）。
7. ソースコードと要件ファイルは Edit / Write ツールで変更する。Bash のリダイレクト・`sed -i` 等での書き換えはフックが拒否する。
8. 要件を `approved` / `done` にするのはユーザー。Claude が変更しようとすると確認が入る。
6. 会話でも用語集の言葉を使う。`avoid` の言い換えは使わない。

## コマンド（`H=python3 .claude/harness/harness.py`）
- `$H status` 現在の工程 / `$H check` 全検査 / `$H lint <file>` 原則チェック / `$H trace` 整合性
- `$H verify` 全検証（リリースゲートの記録）
- `$H overview` 全体俯瞰 docs/overview.md（モデル図・状態遷移・要件×テスト・進捗）を再生成
- `$H explain P26` 原則の要約

## サブエージェント
- `domain-modeler` 要件の言葉からモデルを抽出・整理
- `design-reviewer` 原則に基づく独立レビュー（読み取り専用）。各工程の終わりに必ず通す
- `test-designer` 受入基準・非機能要件・業務ルールからテストを設計
- `implementer` 承認済みの要件・設計に沿ってコードとテストを書く（工程04・05）
- `design-coach` 指摘の意味を実コードの Before/After で説明（教育用・読み取り専用）

モデルの使い分け（2026-10-05 梶原）: **実装・テストは Sonnet**（`implementer` / `test-designer`）、**レビューは Opus**（`design-reviewer`）。
親（メインのセッション）は要件・用語集・設計・統合・コミットを担い、実装は `implementer` に任せ、各工程の終わりに `design-reviewer` を通す。
