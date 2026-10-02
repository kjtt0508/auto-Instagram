# 目次 × ハーネス 対応表

『現場で役立つシステム設計の原則』の各項目が、ハーネスのどこで扱われているか。
凡例: **P**=原則（docs/principles.md）/ **L**=lint ルールID / **T**=trace / **G**=gate / **/**=スキル / **@**=サブエージェント / **tpl**=テンプレート

## 第1章 小さくまとめてわかりやすくする
| 項目 | 対応 |
|---|---|
| 変更が大変なプログラムの特徴（長いメソッド・大きいクラス・多い引数） | P02 P25 / L `builtin.function-length` `builtin.file-length` `builtin.too-many-params` |
| 変更するたびに変更が大変になる | P35 / `/refactor` |
| わかりやすい名前を使う（a → qty → quantity） | P01 / L `common.abbreviation` `common.single-letter` `builtin.vague-name` |
| 長いメソッドを「段落」に分ける・目的ごとに変数・メソッドとして独立 | P02 / `/refactor` 段階2 / L `builtin.function-length` |
| 送料 500 のような埋め込み値 | P02 / L `common.magic-number` |
| 異なるクラスの重複したコードをなくす | P03 / @design-reviewer / `/refactor` 段階9 |
| 狭い関心事に特化したクラス・小さなクラス | P02 / L `builtin.file-length` |
| 基本データ型の落とし穴・業務上の桁数・値の範囲（電話番号は String ではない） | P05 P07 / L `builtin.primitive-params` `ts.any` `python.dict-domain` / T 値の invariants |
| 値を扱う専用クラス・値オブジェクトは不変 | P05 P06 / L `*.mutable-*` `*.setter` / references/patterns-*.md |
| 型を使って安全にする・複雑さを閉じ込める | P05 P13 |
| 配列やコレクションを専用クラスに閉じ込める・コレクションは業務の関心事 | P08 / L `java.raw-collection-field` / T kind: collection |

## 第2章 場合分けのロジックを整理する
| 項目 | 対応 |
|---|---|
| 区分や種別がコードを複雑にする | P09 / L `*.kubun-branch` |
| 判断や処理のロジックをメソッドに独立させる | P11 P26 |
| else 句をなくす（早期リターン） | P26 / L `common.else`（calisthenics でエラー） |
| 複文は単文に分ける | P26 / L `common.compound-condition` `builtin.nesting` |
| 区分ごとのロジックを別クラスに・同じ型として扱う・インスタンス生成 | P09 / patterns.md「場合分け」/ 各言語 patterns の区分 |
| enum を使う・区分オブジェクトで分析し整理する | P09 / T kind: kubun（values・behaviors 必須） |
| 状態の遷移ルールをわかりやすく記述する | P10 / T kind: state（transitions 検査）/ overview の状態遷移図 |

## 第3章 業務ロジックをわかりやすく整理する
| 項目 | 対応 |
|---|---|
| データとロジックを別クラスに分けることがわかりにくさを生む・データクラスの問題 | P04 P12 / L `*.getters` `*.setter` |
| 共通機能ライブラリが失敗する理由 | P03 / L `builtin.vague-name`（Util/Helper/Common） |
| データとロジックを一体に・メソッドをロジックの置き場所に・データを持つクラスへ移動 | P04 / L `common.app-calculation` `ts.domain-function` `go.func-on-domain-type` / `/refactor` 段階8 |
| 使う側のクラスに業務ロジックを書き始めたら設計を見直す | P04 / L `common.app-calculation` `common.ui-calculation` |
| メソッドを短く書くとロジックの移動がやりやすくなる | P02 / `/refactor` の順序 |
| メソッドは必ずインスタンス変数を使う | P27 / L `*.static-method` `python.staticmethod` `ruby.class-method` `kotlin.top-level-fun` |
| クラスが肥大化したら小さく分ける | P02 / L `builtin.file-length` |
| パッケージを使ってクラスを整理する | P28 / L `builtin.package-by-type` |
| 三層の関心事と業務ロジックの分離・三層＋ドメインモデル | P15 P16 / 依存方向チェック（全言語）/ adapters |

## 第4章 ドメインモデルの考え方で設計する
| 項目 | 対応 |
|---|---|
| 利用者の関心事とプログラミング単位を一致・分析クラスと設計クラスを一致 | P22 P23 / G モデル先行（用語集に無い型は作れない）/ T コード⇄用語集 |
| 業務に使っている用語をクラス名にする | P23 / G / T 用語ドリフト（avoid） |
| データモデルではなくオブジェクトモデル・手続き型になる理由 | P29 / `/p2-model` 見つけ方 |
| 部分を作りながら全体を組み立てる・全体と部分を行き来・重要な部分から | P22 / `/p2-model` / `/domain-discovery` §2 |
| 独立した部品を組み合わせる・機能の一部として設計しない | P29 / `/p2-model` |
| 重要な関心事や関係性・業務の関心事を分類・ヒト/モノ/コト | P29 / T category / overview のモデル図 / `/domain-discovery` §3 |
| コトは業務ルールの宝庫・何でも約束してよいわけではない・期待されるコト/されていないコト | P29 / T promises（do/dont）/ overview「コトと約束」 |
| トランザクションスクリプトになりがち | P15 / `/p2-model` 迷ったとき / L `common.app-calculation` |
| 段階的に改善する・業務の言葉とコードの一致 | P22 P23 P35 |
| 業務を学びながら成長させる・取捨選択・暗黙知を引き出す・言葉をキャッチ | `/domain-discovery`（§1 §2 §4、references/questions.md） |
| 形式的な資料はかえって危険 | `/domain-discovery` §6 |
| 言葉のあいまいさを具体的にする | P23 / `/domain-discovery` §5 / `/p1-req` 手順6 |
| 基本語彙を増やす | `/domain-discovery` references/vocabulary.md |
| 繰り返しながら知識を広げる・改善を続ける | P22 P35 |

## 第5章 アプリケーション機能を組み立てる
| 項目 | 対応 |
|---|---|
| アプリケーション層の役割・三層＋ドメインモデルの実装 | P15 P16 / 依存方向チェック |
| サービスクラスはごちゃごちゃしやすい・作りながらドメインモデルを改善・育てる | P15 / `/p3-design` シナリオ節 / L `builtin.file-length`（app 120行） |
| 画面の多様な要求を小さく分ける・登録系/参照系 | P15 P30 / tpl design.md |
| 小さく分けたサービスを組み立てる・シナリオクラス | P30 / patterns.md「シナリオ」/ tpl design.md シナリオ表 |
| 利用する側と提供する側の合意を明確にする | P30 / tpl design.md |
| データベースの都合から分離・業務の関心事で考える・リポジトリ | P16 / patterns.md「リポジトリ」/ L `*.domain-purity` |

## 第6章 データベースの設計とドメインオブジェクト
| 項目 | 対応 |
|---|---|
| 用途がわかりにくいカラム | P19 / L `sql.vague-column` `sql.flag` |
| いろいろな用途に使う巨大なテーブル | P19 / `/db-design` §1 / @design-reviewer |
| テーブルの関係がわかりにくい・外部キー制約 | P17 / L `sql.missing-fk` |
| NOT NULL 制約・一意性制約 | P17 / L `sql.nullable` / `/db-design` §2 |
| コトに注目するデータベース設計 | P29 P31 / `/db-design` §3 |
| 記録のタイミングが異なるデータはテーブルを分ける | P31 / `/db-design` §3 / tpl design.md「記録のタイミング」 |
| 記録の変更を禁止する・UPDATE 文は使わない | P18 / L `common.sql-update` `sql.overwrite` `sql.drop` |
| カラムの追加はテーブルを追加する | P31 / L `sql.add-column` |
| 状態の参照・残高更新は同時/1か所でなくてよい・派生情報を転記・状態を動的に導出 | P18 / `/db-design` §4 |
| オブジェクトとテーブルは似てくる・明示的にマッピング・それぞれらしく | P16 P31 / `/db-design` §5 / L `cs.persistence-attr` `go.struct-tags` `php.active-record` `ruby.active-record` |

## 第7章 画面とドメインオブジェクトの設計を連動させる
| 項目 | 対応 |
|---|---|
| 画面にさまざまな関心事が詰め込まれる・画面に引きずられた設計 | P32 / `/ui-design` |
| 画面の関心事を小さく分けて独立・画面も分ける・タスクベース | P32 / `/ui-design` §1 / tpl design.md「画面」 |
| ドメインオブジェクトと画面の食い違いは設計改善の手がかり | P32 / `/ui-design` §3 |
| ドメインオブジェクトに書くべきロジック・HTML の class 属性をドメインから | P32 / `/ui-design` §2 / L `common.ui-calculation` `common.ui-status-branch` |
| 項目の並び順・グルーピングとフィールドの対応 | P32 / `/ui-design` §3 |
| 画面以外の利用者向け情報も整合させる | P23 P32 / `/ui-design` §4 / T 用語ドリフト（docs も走査） |
| デザインとソフトウェア設計を連動させて洗練 | `/ui-design` §5 |

## 第8章 アプリケーション間の連携
| 項目 | 対応 |
|---|---|
| 連携の4つのやり方（ファイル転送・DB 共有・Web API・メッセージング） | P33 / `/api-design` §1 / tpl design.md |
| HTTP の約束事（URI・メソッド・ステータスコード・エラー・表現形式） | `/api-design` §2 |
| 使いにくい API・One Size Fits All・部品を提供する | P20 / `/api-design` §3 |
| 単純なことから始める・動かしながら発展・共同作業の環境（OpenAPI/Swagger UI） | P33 / `/api-design` §3 |
| 中核となる API のセット・複合したサービス・共通/個別の分離 | P20 / `/api-design` §3 |
| バージョン管理・API を進化させる | P33 / `/api-design` §5 / `/p6-release`（互換性） |
| データ形式とドメインオブジェクトの不一致・導出結果か生データか | P21 / `/api-design` §4 / tpl design.md |
| 小さなアプリケーションに分けて組み合わせる・非同期メッセージング | P33 / `/api-design` §5 §6 / T kind: event |

## 第9章 オブジェクト指向の開発プロセス
| 項目 | 対応 |
|---|---|
| V 字モデル・短期間で修正と拡張を繰り返す | P22 / 工程 /p1〜/p6（戻ってよい）|
| ドメインモデル中心の進め方・業務ロジックに焦点 | P22 P29 / G 工程ゲート |
| ソースコードを第一級のドキュメント・多くのドキュメントは不要・更新すべきドキュメント | P34 / `/project-management` §5 / tpl design.md「コードを読めば分かることは書かない」 |
| 全体を俯瞰するドキュメントを作成して共有 | P34 / `harness overview` → docs/overview.md（モデル図・状態遷移・要件×テスト） |
| 技術方式のドキュメントもソースコードで表現 | P34 / harness.yaml・ルールパック・adapters が技術方式そのもの |
| 非機能要件はテストコードで表現する | P34 / T NFR-xxx-xx の紐付け / `/p5-test` |
| 見積もりと契約・進捗の判断・品質保証・要員と体制 | `/project-management` §1〜§6 / overview の進捗 |

## 第10章 オブジェクト指向設計の学び方と教え方
| 項目 | 対応 |
|---|---|
| オブジェクト指向の説明は意味不明・なぜ良いのかわからない | @design-coach（抽象論でなく実コードの Before/After と変更箇所の数で説明） |
| 既存のコードを改善しながら学ぶ・実際のコードで設計の違いを知る | `/refactor` / @design-coach |
| 重複したコード・長いメソッド・巨大なクラス | P02 P03 / L `builtin.*` / `/refactor` の表 |
| リファクタリングは部分的に少しずつ・組み立てやすい部品に改善・少しずつ改良を続ける | P35 / `/refactor` §0〜§3 / baseline からの段階的解消 |
| オブジェクト指向らしい設計を体で覚える・過激なコーディング規則 | `profiles: [calisthenics]`（9規則: インデント1段・else 禁止・プリミティブのラップ・ファーストクラスコレクション・1行1ドット・省略しない・小さなエンティティ・インスタンス変数2つまで・getter/setter 禁止）|
| オブジェクト指向の考え方を理解する（参考文献） | @design-coach の教える順序 |

## 参考文献として挙げられているもの
『エンタープライズ アプリケーションアーキテクチャパターン』（リポジトリ・サービス層）、『ノンデザイナーズ・デザインブック』（画面のグルーピング）、『Web API: The Good Parts』『マイクロサービスアーキテクチャ』『Enterprise Integration Patterns』（連携）、『実装パターン』『オブジェクト指向入門』『ドメイン駆動設計』は、それぞれ `/refactor` `/ui-design` `/api-design` `/p2-model` の背景知識として扱う。ハーネスはこれらの内容を再現しない。
