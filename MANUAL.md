# 簡易マニュアル

> 詳細な一覧は `ハーネス組み込み一覧とマニュアル.xlsx`、設計原則は `docs/principles.md`、書籍との対応は `BOOK_COVERAGE.md`、変更履歴は `CHANGELOG.md`。
> コマンドは `python3 .claude/harness/harness.py <コマンド>`（以下 `harness` と略記）。

## Claude への頼み方
- スキル: `/p1-req` のように入力するか、作業内容を話せば自動で選ばれる。
- エージェント: 「design-reviewer でレビューして」のように名前で依頼する。

## 作業別ガイド

| 場面 | やりたい作業 | スキル | エージェント | コマンド | ポイント |
|---|---|---|---|---|---|
| 導入 | 新規アプリにハーネスを入れる | — | — | harness init | 生成された harness.yaml（言語・レイヤ・verify 手順）を必ず目視確認する |
| 導入 | 既存アプリにハーネスを入れる | —（後で /refactor） | — | harness init → harness baseline → harness scaffold-model | 用語集の todo を埋め終えたら enforcement を deny に上げる |
| 業務理解 | 業務担当者へのヒアリング準備・議事メモの整理 | /domain-discovery | domain-modeler | — | 「普通の1件」を最初から最後まで聞く。例外・境界・理由を聞く |
| 業務理解 | 既存資料・帳票・画面から用語を拾う | /domain-discovery | domain-modeler | — | 資料は言葉を拾う素材。重要度はヒアリングで決める |
| 01 要件定義 | 新機能・改修の要件をまとめる | /p1-req | design-reviewer | harness trace | open_questions が空になりユーザーが同意するまで approved にしない |
| 01 要件定義 | 非機能要件（性能・冪等性など）を決める | /p1-req | test-designer | — | テストで表現できるものは verify_by: test |
| 02 モデル | 用語集・ドメインモデルを作る/育てる | /p2-model（前段に /domain-discovery） | domain-modeler → design-reviewer | harness trace / harness overview | ヒト・モノ・コトで分類し、コトに約束（do/dont）を書く。振る舞いから先に |
| 03 設計 | ユースケース・シナリオを設計する | /p3-design | design-reviewer | — | サービスは登録系/参照系に分け、シナリオで組み立てる |
| 03 設計 | 画面を設計する | /ui-design | design-reviewer | — | 1画面1タスク。表示の判断はドメインに |
| 03 設計 | API・外部連携を設計する | /api-design | design-reviewer | — | 連携方式を目的で選ぶ。導出結果か生データかを明記 |
| 03 設計 | テーブル・マイグレーションを設計する | /db-design | design-reviewer | harness lint <sql> | 記録のタイミングで分ける。UPDATE せず追記、状態は導出 |
| 03 設計 | トレードオフのある判断を残す | /p3-design | — | — | 原則からの逸脱は ADR ＋ harness-allow コメント |
| 04 実装 | ドメイン → アプリ → インフラ → 画面の順で実装 | /p4-impl（＋/ui-design /api-design /db-design） | test-designer（単体テストを同時に） | harness check --changed main | 1ユースケースずつ縦に通す |
| 04 実装 | フックに拒否・ブロックされた | /p4-impl「フックとの付き合い方」 | design-coach | harness explain Pxx | 回避しない。直せない理由があれば ADR を書いて harness-allow |
| 保守 | バグ修正・小さな改修 | /p1-req（AC 追加）→ /p4-impl → /p5-test | test-designer | harness check | 先に不具合を再現するテストを書く |
| 保守 | 既存コードの改善・リファクタリング | /refactor | design-coach、design-reviewer | harness lint <file> | 現状を固定するテスト → 名前 → 段落 → 値オブジェクト … の順 |
| 05 テスト | テスト設計・受入基準との紐付け | /p5-test | test-designer | harness check --strict | ドメイン単体テストを厚く。境界値・全区分・遷移表を網羅 |
| レビュー | 工程の終わり・PR 前のレビュー | — | design-reviewer | harness check --changed main | Critical 0 で次工程へ |
| 06 リリース | リリース・タグ付け・公開 | /p6-release | design-reviewer（データ移行・互換性） | harness verify → harness overview → git tag | verify は現 HEAD・クリーンな作業ツリーで。最後はユーザー確認 |
| 管理 | 進捗報告・見積もり | /project-management | — | harness overview | 進捗＝受入基準のテスト検証率。ドキュメントは用語集・俯瞰・ADR に絞る |
| 教育 | 設計を学ぶ・チームに説明する | /refactor | design-coach | harness explain Pxx / profiles: [calisthenics] | 学習期間だけ過激なコーディング規則を有効に |
| 拡張 | チーム独自ルールを追加する | — | — | harness selftest | good（指摘0）と bad（expect）の例を必ず足す |
| 設定 | 当てはまらない原則を外す・閾値を変える | — | — | — | 例: DB を持たないアプリは principles.disabled: [P17, P18, P19] |

## 導入手順

1. **ファイルを配置** — zip の .claude/ と CLAUDE.md をリポジトリのルートへ（既存の CLAUDE.md・settings.json はマージ）。CI を使うなら .github/workflows/ も
2. **依存を入れる** — Python 3.10 以上で pip install pyyaml（`pip install pyyaml`）
3. **スタック検出** — 言語・レイヤ配置・verify 手順・import 接頭辞を検出して harness.yaml を生成（`python3 .claude/harness/harness.py init`）
4. **設定を確認** — harness.yaml の languages / architecture / verify.steps を目視確認し、必要なら修正
5. **（既存アプリのみ）現状を凍結** — 既存の違反を .harness-baseline.json に記録してコミット（`harness baseline`）
6. **（既存アプリのみ）用語集の下書き** — domain の型を todo 付きで domain.yaml に登録し、業務の呼び名・定義を埋める（`harness scaffold-model`）
7. **（任意）構造テストのアダプタ** — ArchUnit / ESLint / import-linter / deptrac を追加（.claude/harness/adapters/README.md）
8. **動作確認** — 自己テストと現状確認（`harness selftest / harness status`）
9. **開始** — claude を起動（SessionStart で現在の工程が表示される）→ /p1-req から（`claude`）

## 困ったとき

| 症状 | 原因 | 対処 |
|---|---|---|
| Bash でファイルを書こうとしたら拒否された | リダイレクト・sed -i 等でソースコードや要件を書き換えようとした | Edit / Write ツールで変更する（検査を通すため）。プロジェクト外（/tmp 等）やログへの出力は対象外 |
| 要件を approved にしようとしたら確認が出た | 要件の承認はユーザーが行う決まり | 内容を確認して許可する。自動化したい場合のみ enforcement.approval: off |
| harness-allow を書いたのに違反が消えない | 参照している ADR が docs/adr/ に無い | ADR を docs/adr/ADR-xxxx-*.md として作成する（番号が一致すれば有効） |
| 画面から API クライアントを import したらエラーになった | エイリアス（@/）が未設定、または lib/api が infrastructure に割り当てられている | harness.yaml の architecture.aliases と、lib/api を application に割り当てる paths を確認（init --force で再検出可） |
| 本番コードを書こうとしたら「工程ゲート」で拒否された | 承認済み（approved かつ open_questions 無し）の要件、または用語集が無い | /p1-req・/p2-model を先に実施。既存アプリなら enforcement.phase_gate: warn で段階導入 |
| 「モデル先行(P23)」で拒否された | domain に作ろうとした型が用語集（domain.yaml）に無い | 既存用語の名前を使う。新しい概念なら /p2-model で用語を追加（ユーザー確認） |
| 書き込み後に lint でブロックされた | 原則違反（エラー）を検出 | メッセージの原則ID（harness explain Pxx）に沿って直す。意図的なら ADR を書き harness-allow: Pxx ADR-xxxx |
| 既存コードで警告・エラーが大量に出る | 導入前からの違反 | harness baseline で凍結し、新規の違反だけを対象にする。触ったファイルから /refactor で減らす |
| Claude が終了しようとすると止められる | Stop フックが trace のエラーを検出 | 表示されたエラーを解消。段階導入中は enforcement.stop_check: warn |
| git tag / npm publish が拒否された | verify 未実行・失敗、HEAD が変わった、未コミット、リリースノートが無い | コミット → harness verify → docs/releases/vX.Y.Z.md → 再度 verify → タグ |
| ハーネスのファイルを編集しようとすると確認が出る | 保護対象（protected） | ルールを弱める変更でないか確認して承認。恒常的な変更は harness.yaml で |
| 誤検出だと思う | 正規表現ベースの検査の限界 | その箇所は harness-allow（ADR 付き）。ルール自体の問題なら .harness-rules で severity_overrides、tests/fixtures に good 例を追加して selftest |
| レイヤの判定が違う | ディレクトリ名が既定の segments と違う | harness.yaml の architecture.layers に segments または paths（glob）を追加 |
| Windows でフックが動かない | python3 コマンドが無い | .claude/settings.json の python3 を python か py に置き換える |
| 対応していない言語を使っている | 言語パックが無い | lib/lang.py の LANGS に1エントリ追加し rules/<lang>.yaml を作る。selftest で確認 |
| PyYAML が無いと言われる | 依存パッケージ未導入 | pip install pyyaml |

## 自動で動く仕組み（フック）

| フック | タイミング | 何をするか | 設定 |
|---|---|---|---|
| SessionStart | セッション開始時 | 現在の工程・要件承認数・用語数・受入基準の紐付け・エラー数を表示 | — |
| PreToolUse（Edit/Write） | ファイル書き込み前 | 工程ゲート（承認済み要件・用語集の有無）、モデル先行（用語集に無いトップレベル型を domain に作らせない）、要件の承認はユーザー（approved への変更は確認）、ハーネス・ベースラインの保護 | phase_gate, model_first, approval, protect |
| PreToolUse（Bash） | コマンド実行前 | リリースゲート（git tag・タグの push・gh release・npm publish・mvn deploy 等）：verify 成功 @HEAD、未追跡含めクリーン、リリースノート／Bash でのソース・要件の書き換え防止（Edit/Write を使わせる）／保護対象の書き換え・harness baseline・init --force はユーザー確認 | release, bash_writes, protect |
| PostToolUse（Edit/Write） | ファイル書き込み直後 | 言語パックのルール・組み込みチェック・依存方向・SQL 検査。warn モードのゲート警告もここで伝える | lint_errors |
| Stop | Claude が作業を終える時 | trace の整合性エラーがあれば一度だけ終了を止める（無限ループ防止付き） | stop_check |

## コマンド

| コマンド | 内容 | 使う場面 |
|---|---|---|
| `init [--mode strict|legacy] [--force]` | スタック検出 → harness.yaml 生成 | 導入時 |
| `status` | 現在の工程と整合性サマリ | 随時 |
| `check [--strict] [--changed REF]` | trace＋lint＋依存方向の全検査（CI 用） | 実装後・PR 前 |
| `lint <file>...` | 指定ファイルの設計原則チェック | 実装中 |
| `trace [--strict]` | 要件⇄用語集⇄設計⇄コード⇄テストの整合性 | 要件・モデル作成時 |
| `verify` | check --strict＋各スタックのビルド/テスト → リリースゲート記録 | リリース前 |
| `overview` | docs/overview.md（モデル図・状態遷移・要件×テスト・進捗）を生成 | 報告・リリース前 |
| `baseline` | 現状の違反を .harness-baseline.json に凍結 | 既存アプリ導入時 |
| `scaffold-model` | domain の型を用語集に下書き登録（todo） | 既存アプリ導入時 |
| `explain <P番号>` | 原則の要約を表示 | 指摘の意味を知りたいとき |
| `selftest` | ルールパックの自己テスト（good/bad フィクスチャ） | ルール追加・変更時 |
| `hook <session|pre|post|stop>` | Claude Code フックの入口（手で実行しない） | — |
