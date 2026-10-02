#!/usr/bin/env python3
"""ドメインモデル中心 開発ハーネス CLI

  harness init [--mode strict|legacy] [--force]   スタック検出 → harness.yaml 生成
  harness status                                  現在の工程と整合性サマリ
  harness check [--strict] [--changed REF]        trace + lint + arch（CI 用）
  harness lint <file>...                          設計原則チェック
  harness trace [--strict]                        トレーサビリティのみ
  harness verify                                  check --strict + ビルド/テスト → リリースゲート記録
  harness baseline                                現状の違反を .harness-baseline.json に凍結（段階導入）
  harness scaffold-model                          domain の型を用語集に下書き登録
  harness explain <P番号>                          原則の説明
  harness selftest                                ルールパックの自己テスト（ルール追加・変更時）
  harness overview                                全体俯瞰ドキュメント docs/overview.md を生成（進捗・モデル図・対応表）
  harness hook <session|pre|post|stop>            Claude Code フック入口
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib import core, gate, rules, trace, verify  # noqa: E402
from lib import init as init_mod  # noqa: E402

SELF = [f"\"{sys.executable}\"", f"\"{Path(__file__).resolve()}\""]


def cmd_check(strict: bool, changed: str | None) -> int:
    res = trace.check(strict)
    if changed:
        out = subprocess.run(["git", "diff", "--name-only", "--diff-filter=AM", f"{changed}...HEAD"],
                             cwd=core.root(), text=True, capture_output=True).stdout.split()
        files = [core.root() / f for f in out]
    else:
        files = list(rules.source_files())
    findings = [f for p in files for f in rules.lint_file(p)]
    errs = [str(f) for f in findings if f.severity == "error"] + [f"ERROR {e}" for e in res.errors]
    warns = [str(f) for f in findings if f.severity != "error"] + [f"WARN  {w}" for w in res.warnings]
    for m in errs + warns:
        print(m)
    print(f"\n工程: {trace.phase(res)}  エラー {len(errs)} / 警告 {len(warns)}  {json.dumps(res.stats, ensure_ascii=False)}")
    return 1 if errs else 0


def cmd_baseline() -> int:
    fps = sorted({f.fingerprint() for p in rules.source_files() for f in rules.lint_file(p, use_baseline=False)})
    (core.root() / ".harness-baseline.json").write_text(json.dumps(fps, ensure_ascii=False, indent=0), encoding="utf-8")
    print(f"{len(fps)} 件の既存違反を .harness-baseline.json に記録しました（コミットしてください）。以降は新規の違反のみ検出します。")
    return 0


def cmd_scaffold() -> int:
    cfg = core.config()
    names = trace.glossary_names(cfg)
    missing = {n: f for n, f in trace.domain_types(cfg).items() if not trace.name_allowed(n, names, cfg)}
    if not missing:
        print("用語集に無い domain の型はありません")
        return 0
    p = core.root() / cfg["docs"]["model"]
    p.parent.mkdir(parents=True, exist_ok=True)
    head = "" if p.exists() else "context: TODO\nterms:\n"
    body = "".join(f"  - name_ja: ''        # TODO 業務での呼び名\n    code_name: {n}\n    kind: ''           # value|entity|aggregate|collection|kubun|state|rule|service|event\n"
                   f"    definition: ''\n    todo: true         # {f}\n" for n, f in sorted(missing.items()))
    with p.open("a", encoding="utf-8") as fh:
        fh.write(head + body)
    print(f"{len(missing)} 件を {cfg['docs']['model']} に下書き登録しました（todo: true を外すと必須項目がエラー扱いになります）")
    return 0


def cmd_explain(pid: str) -> int:
    p = core.root() / "docs" / "principles.md"
    p = p if p.exists() else core.HARNESS_DIR / "templates" / "principles.md"
    for line in p.read_text(encoding="utf-8").splitlines():
        if line.startswith(f"| {pid.upper()} "):
            print(line.split("|")[2].strip())
            return 0
    print("見つかりません")
    return 1


def cmd_hook(kind: str) -> int:
    cfg = core.config()
    data = core.read_input()
    if kind == "session":
        res = trace.check(False)
        s = res.stats
        print(f"[harness] 工程: {trace.phase(res)} | 要件 {s['approved']}/{s['requirements']} 承認 | 用語 {s['terms']} | "
              f"受入基準テスト {s['ac_linked']}/{s['acceptance_criteria']} | エラー {len(res.errors)} 警告 {len(res.warnings)} | "
              f"言語 {', '.join(cfg.get('languages') or ['auto'])}")
        for e in res.errors[:5]:
            print("  ERROR " + e)
    elif kind == "pre":
        gate.run(data)
    elif kind == "post":
        path = (data.get("tool_input") or {}).get("file_path")
        pending = core.pop_pending()
        found = rules.lint_file(path) if path else []
        errs = [str(f) for f in found if f.severity == "error"]
        warns = [str(f) for f in found if f.severity != "error"] + [f"WARN  [gate] {m}" for m in pending]
        if errs and cfg["enforcement"]["lint_errors"] == "block":
            core.emit({"decision": "block", "reason": "設計原則違反を修正してください（docs/principles.md。意図的な例外は ADR を書いて"
                       " `harness-allow: Pxx ADR-xxxx` コメント）:\n" + "\n".join(errs) + ("\n\n警告:\n" + "\n".join(warns) if warns else "")})
        if errs or warns:
            core.emit({"hookSpecificOutput": {"hookEventName": "PostToolUse",
                                              "additionalContext": "設計原則の指摘（妥当なら修正、意図的なら理由を残す）:\n" + "\n".join(errs + warns)}})
    elif kind == "stop":
        mode = cfg["enforcement"]["stop_check"]
        if mode == "off" or data.get("stop_hook_active"):
            return 0
        res = trace.check(False)
        if res.errors and mode == "block":
            core.emit({"decision": "block", "reason": "終了前にトレーサビリティのエラーを解消してください:\n" + "\n".join(res.errors[:20])})
    return 0


def main():
    ap = argparse.ArgumentParser(prog="harness")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("init"); p.add_argument("--mode", choices=["strict", "legacy"]); p.add_argument("--force", action="store_true")
    sub.add_parser("status")
    p = sub.add_parser("check"); p.add_argument("--strict", action="store_true"); p.add_argument("--changed")
    p = sub.add_parser("lint"); p.add_argument("files", nargs="+")
    p = sub.add_parser("trace"); p.add_argument("--strict", action="store_true")
    sub.add_parser("verify"); sub.add_parser("baseline"); sub.add_parser("scaffold-model")
    p = sub.add_parser("explain"); p.add_argument("pid")
    sub.add_parser("selftest")
    sub.add_parser("overview")
    p = sub.add_parser("hook"); p.add_argument("kind", choices=["session", "pre", "post", "stop"])
    a = ap.parse_args()

    if a.cmd == "init":
        sys.exit(init_mod.run(a.mode, a.force))
    if a.cmd == "status":
        res = trace.check(False)
        print(f"工程: {trace.phase(res)}\n{json.dumps(res.stats, ensure_ascii=False, indent=1)}")
        for m in res.errors:
            print("ERROR " + m)
        sys.exit(0)
    if a.cmd == "check":
        sys.exit(cmd_check(a.strict, a.changed))
    if a.cmd == "lint":
        found = [f for x in a.files for f in rules.lint_file(x)]
        for f in found:
            print(f)
        sys.exit(1 if any(f.severity == "error" for f in found) else 0)
    if a.cmd == "trace":
        res = trace.check(a.strict)
        for m in res.errors:
            print("ERROR " + m)
        for m in res.warnings:
            print("WARN  " + m)
        print(f"\n工程: {trace.phase(res)}")
        sys.exit(1 if res.errors else 0)
    if a.cmd == "verify":
        sys.exit(verify.run(SELF))
    if a.cmd == "baseline":
        sys.exit(cmd_baseline())
    if a.cmd == "scaffold-model":
        sys.exit(cmd_scaffold())
    if a.cmd == "overview":
        from lib import overview
        sys.exit(overview.run())
    if a.cmd == "selftest":
        from lib import selftest
        sys.exit(selftest.run())
    if a.cmd == "explain":
        sys.exit(cmd_explain(a.pid))
    if a.cmd == "hook":
        try:
            sys.exit(cmd_hook(a.kind))
        except SystemExit:
            raise
        except Exception as e:  # フックの不具合で作業を止めない
            print(f"[harness] hook error: {e}", file=sys.stderr)
            sys.exit(0)


if __name__ == "__main__":
    main()
