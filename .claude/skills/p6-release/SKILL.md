---
name: p6-release
description: 工程06 リリース。verify 実行・リリースノート作成・マイグレーション確認・タグ付け/公開までを行う。「リリースして」「タグを切って」「publish して」「本番に出す」で使う。
---

# 06 リリース

リリース操作（`git tag` / `gh release create` / `git push --tags` / `npm publish` 等）は、以下を満たさない限りフックが拒否し、満たしても最終的にユーザー確認を経る。

## 手順
1. 作業ツリーをコミット済みにする（`git status` がクリーン）。
2. `python3 .claude/harness/harness.py verify` → `.harness/last_verify.json` に現 HEAD の成功が記録される。
3. 変更範囲を確認（前回タグからの `git log` / `git diff --stat`）。対象 REQ を `status: done` に。
4. `.claude/harness/templates/release-note.md` → `docs/releases/vX.Y.Z.md`
   - 業務上の変更は**ドメインの言葉**で書く（テーブル名・クラス名で書かない）
   - データ移行: 追記型か、既存データを変換するか、ロールバック手順
   - 外部契約（API / CLI / ライブラリの公開インターフェース）の後方互換性
5. `python3 .claude/harness/harness.py overview` で `docs/overview.md`（全体俯瞰・進捗・対応表）を更新してコミットに含める。
6. リリースノートをコミット → **もう一度 verify**（HEAD が変わったため）。
7. `design-reviewer` にリリース前レビュー（データ移行と互換性中心）を依頼。
8. ユーザーの承認を得てタグ付け・公開。CI の release ワークフローがリリースノートを本文に GitHub Release を作る。

## バージョニング（SemVer）
- MAJOR: 外部契約の破壊的変更・データの非互換変更
- MINOR: 要件（REQ）の追加
- PATCH: 不具合修正・リファクタリング
