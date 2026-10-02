"""ルールパックの自己テスト：tests/fixtures の good_* は指摘 0、bad_* は expect の全ルールが検出されること"""
from __future__ import annotations

import os
import re
import shutil
import tempfile
from pathlib import Path

from .core import HARNESS_DIR


def run() -> int:
    fixtures = sorted((HARNESS_DIR / "tests" / "fixtures").glob("*"))
    tmp = Path(tempfile.mkdtemp(prefix="harness-selftest-"))
    os.environ["CLAUDE_PROJECT_DIR"] = str(tmp)
    from . import core, rules
    core._CFG = None
    failures = 0
    try:
        for fx in fixtures:
            # 命名: <good|bad>[@レイヤ]_<ファイル名>、ファイル名中の "__" はサブディレクトリ
            head, name = fx.name.split("_", 1)
            kind, _, layer = head.partition("@")
            name = name.replace("__", "/")
            text = fx.read_text(encoding="utf-8")
            prof = re.search(r"profile:\s*(\w+)", text)
            (tmp / "harness.yaml").write_text(f"profiles: [{prof.group(1)}]\n" if prof else "", encoding="utf-8")
            core._CFG = None
            rules._PACKS = None
            sub = "db/migration" if fx.suffix == ".sql" else f"src/{layer or 'domain'}"
            dest = tmp / sub / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(fx, dest)
            found = rules.lint_file(dest, use_baseline=False)
            got = {f.rule for f in found}
            if kind == "good":
                ok = not found
                detail = "" if ok else "  予期しない指摘: " + ", ".join(sorted(got))
            else:
                m = re.search(r"expect:\s*([\w.\-, ]+)", text)
                want = {w.strip() for w in m.group(1).split(",") if w.strip()} if m else set()
                missing = want - got
                ok = not missing
                detail = "" if ok else "  未検出: " + ", ".join(sorted(missing))
            print(f"{'PASS' if ok else 'FAIL'}  {fx.name}{detail}")
            failures += 0 if ok else 1
            dest.unlink()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    total = len(fixtures)
    f2, n2 = scenario_tests()
    failures += f2
    total += n2
    print(f"\n{total - failures}/{total} passed")
    return 1 if failures else 0


# ---------------- シナリオテスト（フック・レイヤ判定・例外の検証） ----------------
SCENARIO_FILES = {
    "harness.yaml": (
        "languages: [java, typescript]\n"
        "architecture:\n"
        "  internal_prefixes: [com.example]\n"
        "  aliases: {'@/': frontend/src/}\n"
        "  layers:\n"
        "    presentation: {paths: ['frontend/src/app/**']}\n"
        "    application: {paths: ['frontend/src/lib/api/**']}\n"),
    "docs/requirements/REQ-001.yaml": "id: REQ-001\nstatus: approved\nconcerns: [x]\nacceptance_criteria:\n  - {id: AC-001-01, given: a, when: b, then: c}\n",
    "docs/requirements/REQ-002.yaml": "id: REQ-002\nstatus: draft\nconcerns: [x]\nacceptance_criteria:\n  - {id: AC-002-01, given: a, when: b, then: c}\n",
    "docs/model/domain.yaml": "terms:\n  - {name_ja: 注文, code_name: Order, kind: aggregate, definition: d}\n  - {name_ja: 金額, code_name: Money, kind: value, definition: d}\n",
    "docs/adr/ADR-0001-mutable-order.md": "# ADR-0001\n",
    "frontend/src/lib/api/client.ts": "export const client = {};\n",
    "frontend/src/app/page.tsx": 'import { client } from "@/lib/api/client";\nexport default function P() { return null; }\n',
    "frontend/src/domain/quantity.ts": 'import { client } from "@/lib/api/client";\nexport class Quantity { constructor(readonly value: number) {} }\n',
    "backend/src/main/java/com/example/order/domain/Order.java":
        "package com.example.order.domain;\n// harness-allow-file: P06 ADR-0001\npublic final class Order {\n    private long version;\n}\n",
    "backend/src/main/java/com/example/order/domain/Money.java":
        "package com.example.order.domain;\n// harness-allow-file: P06 ADR-0999\npublic final class Money {\n    private long yen;\n}\n",
    "backend/src/main/resources/db/migration/V1__t.sql": "CREATE TABLE t (\n  id BIGINT PRIMARY KEY,\n  memo2 TEXT -- nullable:\n);\n",
}


def _hook(tmp: Path, tool: str, ti: dict) -> str:
    import json, subprocess, sys
    r = subprocess.run([sys.executable, str(HARNESS_DIR / "harness.py"), "hook", "pre"],
                       input=json.dumps({"tool_name": tool, "tool_input": ti}), capture_output=True, text=True,
                       env={**os.environ, "CLAUDE_PROJECT_DIR": str(tmp)})
    out = r.stdout.strip()
    return json.loads(out)["hookSpecificOutput"]["permissionDecision"] if out else "allow"


def scenario_tests() -> tuple[int, int]:
    from . import core, rules
    tmp = Path(tempfile.mkdtemp(prefix="harness-scenario-"))
    for rp, c in SCENARIO_FILES.items():
        (tmp / rp).parent.mkdir(parents=True, exist_ok=True)
        (tmp / rp).write_text(c, encoding="utf-8")
    os.environ["CLAUDE_PROJECT_DIR"] = str(tmp)
    core._CFG = None
    rules._PACKS = None
    rules._ADRS = None
    J = str(tmp / "backend/src/main/java/com/example/order/domain")
    cases = [
        # (名前, 実行, 期待値)
        ("gate: Bash で本番コードを書く → deny", lambda: _hook(tmp, "Bash", {"command": f"cat > {J}/Hack.java <<EOF\nclass Hack {{}}\nEOF"}), "deny"),
        ("gate: Bash の sed -i で本番コード → deny", lambda: _hook(tmp, "Bash", {"command": f"sed -i 's/a/b/' {J}/Money.java"}), "deny"),
        ("gate: Bash でハーネス設定を書き換え → ask", lambda: _hook(tmp, "Bash", {"command": "sed -i s/deny/off/ harness.yaml"}), "ask"),
        ("gate: Bash で要件ファイルを書き換え → deny", lambda: _hook(tmp, "Bash", {"command": "echo x >> docs/requirements/REQ-002.yaml"}), "deny"),
        ("gate: Bash でテスト・一時ファイル → allow", lambda: _hook(tmp, "Bash", {"command": "echo x > /tmp/a.txt && ls > out.log 2>&1"}), "allow"),
        ("gate: harness baseline → ask", lambda: _hook(tmp, "Bash", {"command": "python3 .claude/harness/harness.py baseline"}), "ask"),
        ("gate: タグ名での push → deny（verify 未実行）", lambda: _hook(tmp, "Bash", {"command": "git push origin v1.0.0"}), "deny"),
        ("gate: ベースラインを Write → ask", lambda: _hook(tmp, "Write", {"file_path": str(tmp / ".harness-baseline.json"), "content": "[]"}), "ask"),
        ("gate: Claude が要件を approved に → ask", lambda: _hook(tmp, "Edit", {"file_path": str(tmp / "docs/requirements/REQ-002.yaml"),
                                                                             "old_string": "status: draft", "new_string": "status: approved"}), "ask"),
        ("gate: 承認済み要件の別項目を編集 → allow", lambda: _hook(tmp, "Edit", {"file_path": str(tmp / "docs/requirements/REQ-001.yaml"),
                                                                               "old_string": "concerns: [x]", "new_string": "concerns: [y]"}), "allow"),
        ("gate: 入れ子の private 型 → allow", lambda: _hook(tmp, "Write", {"file_path": f"{J}/Order.java",
                                                                        "content": "public final class Order {\n  private static final class Snapshot {}\n}"}), "allow"),
        ("gate: 用語集に無いトップレベル型 → deny", lambda: _hook(tmp, "Write", {"file_path": f"{J}/Invoice.java", "content": "public final class Invoice {}"}), "deny"),
        ("gate: 設定ファイル（*.config.*）→ allow", lambda: _hook(tmp, "Edit", {"file_path": str(tmp / "frontend/next.config.mjs"), "old_string": "a", "new_string": "b"}), "allow"),
        ("layer: domain/service は domain", lambda: core.layer_of("b/com/x/order/domain/service/Pricing.java", core.config()), "domain"),
        ("layer: api/ 配下の domain は domain", lambda: core.layer_of("api/src/com/x/order/domain/Money.java", core.config()), "domain"),
        ("layer: エイリアス @/lib/api は application", lambda: rules.import_layer("@/lib/api/client", False, "frontend/src/app/page.tsx", "typescript", core.config()), "application"),
        ("arch: 画面 → @/lib/api は許可", lambda: [f.rule for f in rules.lint_file(tmp / "frontend/src/app/page.tsx")], []),
        ("arch: domain → @/lib/api は禁止", lambda: [f.rule for f in rules.lint_file(tmp / "frontend/src/domain/quantity.ts")], ["arch.layer"]),
        ("allow: 実在する ADR の例外は有効", lambda: [f.rule for f in rules.lint_file(tmp / "backend/src/main/java/com/example/order/domain/Order.java")], []),
        ("allow: 実在しない ADR の例外は無効", lambda: sorted({f.rule for f in rules.lint_file(tmp / "backend/src/main/java/com/example/order/domain/Money.java")}),
         ["harness.allow-without-adr", "java.mutable-field"]),
        ("sql: 理由が空の nullable は警告", lambda: sorted({f.rule for f in rules.lint_file(tmp / "backend/src/main/resources/db/migration/V1__t.sql")}), ["sql.nullable", "sql.vague-column"]),
    ]
    fails = 0
    try:
        for name, fn, want in cases:
            try:
                got = fn()
            except Exception as e:  # noqa: BLE001
                got = f"例外: {e}"
            ok = got == want
            fails += 0 if ok else 1
            print(f"{'PASS' if ok else 'FAIL'}  {name}" + ("" if ok else f"  期待={want} 実際={got}"))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return fails, len(cases)
