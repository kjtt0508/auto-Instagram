# 変更履歴

## レビュー対応（2026-09）

### 検査をすり抜けられた穴（重大）
- **Bash 経由の書き換え**: `cat >` / `sed -i` / `tee` / `cp` / `mv` / `rm` 等でソースコード・要件・ハーネスを変更すると、工程ゲートと lint を通らずに済んでいた → PreToolUse(Bash) で書き込み先を解析し、ソース・要件は拒否（`enforcement.bash_writes`）、保護対象はユーザー確認。
- **実在しない ADR での例外**: `harness-allow: P06 ADR-9999` のように存在しない ADR 番号でも違反を抑止できていた → `docs/adr/` に実在する ADR だけ有効。無効な例外は `harness.allow-without-adr` エラー。
- **ベースラインの改ざん**: `.harness-baseline.json` の編集と `harness baseline` の実行を Claude が自由にでき、新しい違反を凍結できた → 保護対象に追加、`baseline` / `init` はユーザー確認。
- **要件の自己承認**: CLAUDE.md では「承認はユーザー」だが仕組みで守られていなかった → 要件を approved/done にする変更はユーザー確認（`enforcement.approval`）。

### 誤判定・誤検出
- **パスエイリアス未解決**: `@/lib/api` をディレクトリ名 `api` で判定していた → `architecture.aliases`（tsconfig の paths から init が検出）で実パスに解決。
- **Next.js の標準的な依存がエラー**: 画面 → `lib/api` が presentation → infrastructure 違反になっていた → `lib/api`・`hooks` を application に割り当て。
- **`domain/service` がアプリケーション層扱い**: → パスに domain があれば domain を優先。
- **設定ファイルまで工程ゲート対象**: `next.config.mjs` 等が要件承認前に編集できなかった → `source.gate_exempt_patterns`（*.config.*, *.gradle.kts, scripts/ 等）を対象外に。
- **入れ子の補助型にも用語集登録を要求**: → トップレベルの型だけを対象に。
- **Java の base package にコンテキスト名が混入**: `com.example.order` になり他コンテキストの import を判定できなかった → コンテキスト部分を除いて検出。

### 不足
- タグ名指定の push（`git push origin v1.0.0`）・`mvn deploy`・`gradle publish` をリリース操作として検出。
- 未追跡ファイルがあっても verify が「クリーン」と記録していた → 未追跡も未コミット扱い。
- `-- nullable:` の理由が空でも通っていた → 理由必須。`memo2` のような番号付きの曖昧カラムも検出。
- ArchUnit アダプタの許可方向（infrastructure → application）が本体と食い違っていた → 揃えた。
- フックにタイムアウトを設定（Pre/Post 30 秒、SessionStart/Stop 60 秒）。

### 回帰テスト
`harness selftest` にシナリオテスト 21 件を追加（上記すべての再発防止）。フィクスチャ 28 件と合わせて 49 件。
