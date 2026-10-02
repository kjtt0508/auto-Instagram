# ADR-0005: TS（画面・API関数）と Java（定期処理）の同じルールは、共通のテストケースと DB の制約で揃える

- 状態: 承認（2026-10-02 梶原。TS・Java・DB の3か所で fixtures を読む形を実装済み）
- 日付: 2026-10-01
- 関連: REQ-001, REQ-002 / 原則 P04, P24

## 背景
画面側（TS）と定期処理（Java）が同じ業務ルール（投稿状態の遷移、画像仕様、キャプション、PR表記、テンプレートへの差し込み、下書き案の検証）を必要とする。
言語が違うためコードは共有できず、ルールが食い違うと「画面では通ったのに公開で落ちる」事故になる。

## 決定
- 同じルールを持つドメインオブジェクトは、`docs/model/fixtures/<用語>.json` に**入力と期待値**の表を置き、TS と Java の単体テストが同じファイルを読む。ルールを変えるときは fixtures から変える。
- 投稿状態の遷移表は DB（`post_status_transitions`）にも置き、出来事の記録時にトリガーで確かめる（最後の砦）。
- 定期処理は、公開の直前に画像仕様・枚数と、PR入稿由来の投稿のPR区分（ステマ対策）を再検証する（画面の検証を信用しすぎない）。
- **DB に置くのは遷移表（出来事の種類と遷移の組）・版の固定・値域（区分の CHECK）・正の数・一意だけ**。画像仕様（幅・比率・容量）や文字数のような業務ルールは DB の CHECK にしない（変更のたびにマイグレーションが要り、4〜5重になるため）。

二重実装の対象: `PostStatus`、`PostFormat`、`PostMediaList`、`ImageSpec`、`Caption`、`PrCategory`、`IdeaSource`（PR区分の固定）、`ScheduledAt`、`TokenExpiry`、`FailureKind`（guidance のみ TS）、`Template.fill`、`DraftProposal`、`GenerationRetryPolicy`、トークンの暗号化（ADR-0007）。

## 検討した代替案
- ルールを DB 関数（PL/pgSQL）に寄せる: 1か所になるが、業務ロジックが DB に散らばり、テストもしにくい（P16）。
- 定期処理も TypeScript で書く: 要件で Java（Spring Boot・Playwright for Java）が指定されている。変更するなら要件を直す。

## 結果
- 二重実装のコストがかかる。対象は表のオブジェクトに限り、それ以外は片方にだけ置く（例: 公開猶予・ジョブは Java のみ、警告・ロールは TS のみ）。
