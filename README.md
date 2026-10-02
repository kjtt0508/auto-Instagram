# ドメインモデル中心 開発ハーネス（Claude Code・言語非依存）

> 使い方は [`MANUAL.md`](MANUAL.md)（作業別にどのスキル・エージェントを使うか）。書籍の全10章の各項目とハーネスの対応は [`BOOK_COVERAGE.md`](BOOK_COVERAGE.md)。原則は P01–P35（`docs/principles.md`）。

『現場で役立つシステム設計の原則』の考え方を、**要件定義 → モデリング → 設計 → 実装 → テスト → リリース**の全工程で
Claude Code に守らせるハーネス。コアは言語非依存で、言語ごとの差分は「ルールパック（YAML）」と「スタック検出」に閉じ込めてある。

## 対応スタック
| 言語 | 代表的なフレームワーク | 検出マーカー | 既定の verify |
|---|---|---|---|
| Java / Kotlin | Spring Boot, Quarkus, Ktor | pom.xml / build.gradle(.kts) | `mvn verify` / `gradlew check` |
| TypeScript / JavaScript | Next.js, React, Vue, NestJS, Express | package.json | `npm run lint/typecheck/test/build`（存在するもの） |
| Python | Django, FastAPI, Flask | pyproject.toml / requirements.txt | `ruff` / `mypy`（あれば）+ `pytest` |
| Go | net/http, Gin, Echo | go.mod | `go vet` + `go test` |
| C# | ASP.NET Core | *.sln / *.csproj | `dotnet test` |
| PHP | Laravel, Symfony | composer.json | `composer test` / `phpunit` |
| Ruby | Rails | Gemfile | `rspec` / `rake test` |
| SQL | マイグレーション全般 | `**/migration(s)/**/*.sql` | — |

モノレポ（複数スタック混在）もそのまま扱える。上記以外の言語は「独自ルール」の節を参照。

## 仕組み
| 層 | 何を | いつ |
|---|---|---|
| **gate**（PreToolUse） | 工程の順序（要件承認→モデル→実装）、モデル先行（用語集に無い型を domain に作らせない）、要件承認の保護、Bash 経由の書き換え防止、ハーネス・ベースラインの保護、リリース条件 | 書き込み・コマンドの**前** |
| **lint**（PostToolUse） | 言語パックによる原則違反の検出 + 全言語共通の依存方向チェック + 関数/ファイル長・基本型への執着 | 書き込みの**直後** |
| **trace**（SessionStart / Stop / CI） | 要件⇄用語集⇄設計⇄コード⇄テストの紐付け、用語ドリフト | セッション開始・終了、CI |
| **verify** | check --strict + 各スタックのビルド/テスト → リリースゲート用の記録 | リリース前・CI |
| **design-reviewer** | 機械で見られない「業務ロジックの置き場所」 | 各工程の終わり |
| **overview** | 全体俯瞰ドキュメント（ヒト/モノ/コトのモデル図・状態遷移図・コトの約束・要件×テスト・進捗） | 随時・リリース前 |

レイヤはディレクトリ名で判定する（`domain` / `application`・`usecase`・`service` / `presentation`・`controller`・`web`・`handler`・`ui`… / `infrastructure`・`infra`・`persistence`・`adapter`…）。
import 文を解析して、レイヤ間の依存方向と、ドメインからフレームワークへの依存を検査する。

## 導入
```bash
# 1. このディレクトリの .claude/ と CLAUDE.md をリポジトリのルートへ（既存の CLAUDE.md / settings.json はマージ）
#    CI も使うなら .github/workflows/ も
# 2. 依存
pip install pyyaml            # Python 3.10+
# 3. スタック検出 → harness.yaml 生成
python3 .claude/harness/harness.py init
```
`init` は言語・verify 手順・自プロジェクトの import 接頭辞（Java の base package、Go の module、PHP の PSR-4 等）・フレームワーク固有の配置（Next.js の app/、Laravel の app/Models、Rails の app/models 等）を検出して `harness.yaml` に書き出す。内容は必ず目視で確認する。

### 新規アプリ
`init` は厳格モードで生成する。`claude` を起動すると SessionStart で現在の工程が表示されるので、`/p1-req` から始める。

### 既存アプリ（段階導入）
ソースが既にある場合、`init` は工程ゲート・モデル先行を **warn**（止めずに警告）にする。
```bash
python3 .claude/harness/harness.py baseline        # 既存の違反を .harness-baseline.json に凍結（コミットする）
python3 .claude/harness/harness.py scaffold-model  # 既存 domain の型を用語集に todo 付きで下書き
```
以降は**新しく入った違反だけ**が検出される。用語集を埋め終えたら `harness.yaml` の `enforcement` を `deny` に上げる。
ドメイン層が存在しないアプリでも、依存方向以外のチェックとトレーサビリティは機能する。domain ディレクトリを切り出すところから始めるとよい。

## 工程フロー
```
/p1-req ────▶ docs/requirements/REQ-xxx.yaml (approved)   未承認なら本番コードは書けない
/p2-model ──▶ docs/model/domain.yaml（用語集 = SSOT）      未登録の型は domain に作れない
/p3-design ─▶ docs/design/REQ-xxx.md + docs/adr/           strict で必須
/p4-impl ───▶ domain → application → infrastructure → presentation（lint がブロック）
/p5-test ───▶ テスト名/タグに AC-xxx-xx を含めて紐付け（strict で必須）
/p6-release ▶ verify 成功 @HEAD + docs/releases/vX.Y.Z.md → tag/publish（ユーザー確認）→ CI が Release 作成
```

## スキルとエージェント
| 種別 | 名前 | 章 | 用途 |
|---|---|---|---|
| 工程 | `/p1-req` 〜 `/p6-release` | 全体 | 要件定義 → リリースの各工程 |
| 補助 | `/domain-discovery` | 4 | 言葉のキャッチ、暗黙知の引き出し、あいまいさの具体化、ヒト/モノ/コト、基本語彙 |
| 補助 | `/ui-design` | 7 | タスクベースの画面、表示判断をドメインへ、項目グループとの対応 |
| 補助 | `/api-design` | 8 | 連携方式の選択、HTTP の約束、OpenAPI、バージョン、導出結果/生データ |
| 補助 | `/db-design` | 6 | コト中心のテーブル、追記のみ、状態の導出、制約、マッピング |
| 補助 | `/refactor` | 1–3, 10 | 既存コードを小さく改善する順序 |
| 補助 | `/project-management` | 9 | 進捗・見積もり・契約・品質保証・ドキュメント方針・体制 |
| エージェント | `domain-modeler` / `design-reviewer` / `test-designer` / `design-coach` | 4, 全体, 9, 10 | モデル抽出 / 独立レビュー / テスト設計 / 教育 |

## 過激なコーディング規則（10章）
`harness.yaml` に `profiles: [calisthenics]` を加えると、インデント1段・else 禁止・プリミティブのラップ・1行1ドット・省略しない・50行・インスタンス変数2つまで・getter 禁止がエラー/警告になる。学習期間や改善中のモジュールで一時的に使う。

## harness.yaml でよく調整するもの
```yaml
architecture:
  layers:
    application:
      segments: [application, usecase, interactor]     # 自分たちのディレクトリ名に合わせる
    infrastructure:
      paths: ["src/lib/api/**"]                         # 名前で判定できない場所は glob で
  internal_prefixes: [com.acme, "@/"]                   # 自プロジェクトの import だけをレイヤ判定対象に
principles:
  disabled: [P17, P18, P19]                             # DB を持たないアプリなど
limits:
  function_lines: 30
enforcement:
  model_first: warn
verify:
  steps:
    - { name: e2e, run: "npx playwright test", cwd: e2e }
```
全項目と既定値は `.claude/harness/defaults.yaml`。

## 原則からの例外
`docs/adr/` に ADR を書いたうえで、該当行（またはその直前の行）にコメントする。ADR 番号が無い、または ADR ファイルが実在しない許可は無効（`harness.allow-without-adr` エラー）。
```java
private int stock; // harness-allow: P06 ADR-0007
```
ファイル全体なら `harness-allow-file: P06 ADR-0007`。

## 独自ルール・未対応言語
`.harness-rules/*.yaml`（プロジェクトルート）に置くと、同じ `language` のパックに追加される。`severity_overrides: {ルールID: error}` で既存ルールの重大度も変えられる。新しい言語は `lib/lang.py` の `LANGS` に1エントリ（拡張子・コメント・import・型宣言・関数の正規表現）を足し、`rules/<lang>.yaml` を作る。
```yaml
language: java
domain_forbidden_imports: ['^com\.acme\.legacy\.']
rules:
  - id: acme.no-date
    principle: P05
    severity: error            # error: 修正させる / warn: 警告
    layers: [domain]           # 省略で全レイヤ
    pattern: '\bjava\.util\.Date\b'
    message: 日付は業務の値オブジェクト（営業日・締日など）で表す
```
| オプション | 意味 |
|---|---|
| `target: raw` | コメント・文字列を除去せずに検査（既定は除去後のコード） |
| `member_of: <正規表現>` | クラス等のトップレベルブロック直下の行だけを対象（ブロック開始行に一致） |
| `unless_line` / `exclude_file_if` | 行 / ファイル単位の除外 |
| `outside_funcs: [..]` | その関数の外にある行だけ（Python・Ruby） |
| `count_over: <limits のキー>` | 一致数が上限を超えたときだけ 1 件報告（`{count}` で件数） |
| `max_hits: N` | 1ファイルあたりの報告数の上限 |
| `file_requires: {pattern, member_of, min}` | ファイル内の一致数が min 以上のときだけ適用 |
| `languages: [..]` | common パックで対象言語を絞る |

ルールを足したら `tests/fixtures/` に `good_*`（指摘 0 になるべきコード）と `bad_*`（`expect: ルールID, ...` をコメントで）を置き、
（`bad@presentation_X.tsx` でレイヤ指定、`bad_dto__X.java` でサブディレクトリ、`profile: calisthenics` コメントでプロファイル指定）
`python3 .claude/harness/harness.py selftest` で誤検出・見逃しが無いことを確認する。

## CLI（`python3 .claude/harness/harness.py <cmd>`）
| コマンド | 用途 |
|---|---|
| `init [--mode strict\|legacy] [--force]` | スタック検出 → harness.yaml |
| `status` | 現在の工程と整合性 |
| `check [--strict] [--changed REF]` | trace + lint + 依存方向（CI 用） |
| `lint <file>...` / `trace [--strict]` | 個別実行 |
| `verify` | check --strict + ビルド/テスト → `.harness/last_verify.json` |
| `baseline` / `scaffold-model` | 既存アプリの段階導入 |
| `explain P12` / `selftest` | 原則の要約 / ルールパックの自己テスト |
| `overview` | docs/overview.md（全体俯瞰・進捗）を生成 |

## 構造テストのアダプタ（任意）
本体の依存方向チェックは正規表現ベース。ビルド時に厳密に検査したい場合は `.claude/harness/adapters/`（ArchUnit / ESLint / import-linter / deptrac）を追加する。

## 限界
- lint は正規表現ベースのヒューリスティック。「業務ロジックがどこにあるか」「ルールの重複」など意味的な判断は design-reviewer の担当。
- 型宣言の抽出も正規表現なので、マクロやコード生成で作られる型は検出されない。
- Windows で `python3` が無い環境では `.claude/settings.json` のコマンドを `python` か `py` に置き換える。
# auto-Instagram
