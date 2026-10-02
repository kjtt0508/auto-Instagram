# ADR-0006: 予定表（jobs）・カウンタ（llm_usage_daily）・照合値（oauth_states）・削除期限（pr_submission_contacts）は UPDATE / DELETE を許す

- 状態: 提案
- 日付: 2026-10-01
- 関連: REQ-001, REQ-002, REQ-003 / 原則 P18

## 背景
原則 P18 は「上書きより追記、状態は記録から導出」。投稿・連携・生成などの業務の記録はこれに従う。
一方で次のものは、記録ではなく「仕組みのための作業領域」で、追記にすると排他や加算が難しくなる。

## 決定
| テーブル | 許すこと | 理由 |
|---|---|---|
| jobs | status・attempts・locked_until の UPDATE | `FOR UPDATE SKIP LOCKED` による実行権の取得。試行ごとの事実は `job_attempts`・`job_attempt_results` に追記で残す |
| llm_usage_daily | count の UPDATE | `INSERT ... ON CONFLICT DO UPDATE ... WHERE count < limit` で原子的に確保するため |
| oauth_states | 使用時の DELETE | 使い捨ての照合値。残す意味がない |
| pr_submission_contacts | delete_after の UPDATE、期限後の DELETE | 個人情報を長く持たないため。削除したこと自体は採否の記録で追える |

## 検討した代替案
- jobs も追記のみにして最新の状態を導出: 排他制御が複雑になり、無料枠の DB に負荷がかかる。

## 結果
- ハーネスの lint が UPDATE を指摘した場合は、この4テーブルに限り `harness-allow: P18 ADR-0006` を付ける。
