# 構造テストのアダプタ（任意）

ハーネス本体の依存方向チェック（`arch.layer` / `arch.domain-purity`）は全言語共通の正規表現ベースで、Claude が書いた直後に効く。
ビルド時にも厳密に検査したい場合は、スタックに合うアダプタを追加して verify.steps に含める。

| スタック | アダプタ | 置き場所 | verify に追加するコマンド |
|---|---|---|---|
| Java / Kotlin | `archunit/ArchitectureTest.java` | `src/test/java/<base>/architecture/` | （mvn verify / gradle check に含まれる） |
| TypeScript / JS | `eslint/eslint.domain.mjs` | フロントエンドのルート | （npm run lint に含まれる） |
| Python | `import-linter/.importlinter` | プロジェクトルート | `lint-imports` |
| PHP | `deptrac/deptrac.yaml` | プロジェクトルート | `vendor/bin/deptrac analyse` |
| C# | ArchUnitNET / NetArchTest を同じ規則で | テストプロジェクト | （dotnet test に含まれる） |
| Go | 本体チェックで十分（`internal/` による可視性制御も併用） | — | — |
