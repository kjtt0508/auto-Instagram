"""PreToolUse：工程ゲート / モデル先行 / 承認の保護 / ハーネス保護 / Bash 経由の書き込み / リリースゲート"""
from __future__ import annotations

import json
import re
import subprocess

from . import lang as L
from .core import config, decide_pre, is_excluded, is_gate_exempt, is_test, layer_of, rel, root
from .trace import glossary_names, is_approved, load_model, load_requirements, name_allowed

RELEASE_CMD = re.compile(
    r"\bgit\s+tag\b|\bgh\s+release\s+create\b"
    r"|\bgit\s+push\b[^;&|]*(--tags|--follow-tags|\brefs/tags/|\bv\d+\.\d+\.\d+)"
    r"|\b(npm|pnpm|yarn)\s+publish\b|\bcargo\s+publish\b|\btwine\s+upload\b|\bdotnet\s+nuget\s+push\b"
    r"|\bmvn\w*\s+[^;&|]*\bdeploy\b|\bgradlew?\s+[^;&|]*\bpublish\b")
# ハーネスの防御を外すコマンド（ユーザー確認）
HARNESS_WEAKEN = re.compile(r"harness\.py\"?\s+(baseline|init\s+[^;&|]*--force)\b")

# Bash でファイルを書き換えるパターン → 書き込み先
WRITE_TARGETS = [
    re.compile(r"(?:^|[\s;&|(])\d?>>?\s*([^\s;&|<>()]+)"),            # > file / >> file
    re.compile(r"\btee\s+(?:-a\s+|--append\s+)?([^\s;&|<>()]+)"),     # tee file
    re.compile(r"\bsed\s+(?:-\w*i\w*|--in-place)\S*\s+(?:(?:-e\s+)?(?:'[^']*'|\"[^\"]*\"|\S+)\s+)+?([^\s;&|<>()'\"]+)\s*(?:$|[;&|])"),
    re.compile(r"\bperl\s+-\w*i\w*\s+.*?\s([^\s;&|<>()'\"]+)\s*(?:$|[;&|])"),
    re.compile(r"\b(?:cp|mv|install|ln)\s+(?:-\S+\s+)*\S+\s+([^\s;&|<>()]+)"),
    re.compile(r"\brm\s+(?:-\S+\s+)*([^\s;&|<>()]+)"),
    re.compile(r"\btruncate\s+(?:-\S+\s+\S+\s+)*([^\s;&|<>()]+)"),
    re.compile(r"\bgit\s+(?:checkout|restore)\s+(?:\S+\s+)*--\s+([^\s;&|<>()]+)"),
]


def git_head() -> str:
    try:
        return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root(), text=True,
                                       stderr=subprocess.DEVNULL).strip()
    except Exception:
        return ""


def release_problem(cmd: str, cfg) -> str | None:
    stamp = root() / ".harness" / "last_verify.json"
    if not stamp.exists():
        return "リリースゲート: verify が未実行です（python3 .claude/harness/harness.py verify）。/p6-release の手順に従ってください。"
    s = json.loads(stamp.read_text(encoding="utf-8"))
    if not s.get("passed"):
        return f"リリースゲート: 直近の verify が失敗しています（{s.get('failed_step')}）。"
    if s.get("dirty"):
        return "リリースゲート: verify 時に未コミット（未追跡を含む）の変更がありました。コミット後に再実行してください。"
    if s.get("head") != git_head():
        return "リリースゲート: verify 後に HEAD が変わっています。現在の HEAD で verify を再実行してください。"
    m = re.search(r"\bv\d+\.\d+\.\d+(?:-[\w.]+)?\b", cmd)
    if m and not (root() / cfg["docs"]["releases"] / f"{m.group(0)}.md").exists():
        return f"リリースゲート: リリースノート {cfg['docs']['releases']}/{m.group(0)}.md がありません。"
    return None


def is_protected(r: str, cfg) -> bool:
    return any(r == p or r.startswith(p) or r.endswith("/" + p) for p in cfg.get("protected", []))


def is_source(r: str, cfg) -> bool:
    return bool(L.lang_of(r, cfg.get("languages") or None)) and not is_test(r, cfg) \
        and not is_excluded(r, cfg) and not is_gate_exempt(r, cfg)


def bash_targets(cmd: str) -> list[str]:
    out = []
    for rx in WRITE_TARGETS:
        for m in rx.finditer(cmd):
            t = m.group(1).strip("'\"")
            if not t or t.startswith(("&", "/dev/", "$")) or t == "-":
                continue
            r = rel(t)
            if not r.startswith("/"):  # プロジェクト外（/tmp 等）への書き込みは対象外
                out.append(t)
    return out


def check_bash(cmd: str, cfg, enf):
    if RELEASE_CMD.search(cmd):
        prob = release_problem(cmd, cfg)
        if prob:
            decide_pre(enf["release"], prob)
            return
    if HARNESS_WEAKEN.search(cmd):
        decide_pre("ask", "ハーネスの検査を弱める操作です（baseline は既存違反の凍結、init --force は設定の再生成）。"
                          "新しい違反を凍結しようとしていないか確認してください。")
        return
    targets = [rel(t) for t in bash_targets(cmd)]
    for r in targets:
        if is_protected(r, cfg):
            decide_pre(enf["protect"], f"Bash でハーネス保護対象 {r} を変更しようとしています。ルールを弱める変更でないか確認してください。")
            return
    for r in targets:
        if is_source(r, cfg) or re.match(re.escape(cfg["docs"]["requirements"]) + r"/REQ-", r):
            decide_pre(enf["bash_writes"],
                       f"Bash で {r} を書き換えようとしています。ソースコードと要件は Edit / Write ツールで変更してください"
                       "（工程ゲート・モデル先行・設計原則の検査を通すため）。")
            return


def new_content(tool: str, ti: dict) -> str:
    if tool == "Write":
        return ti.get("content", "")
    if tool == "Edit":
        return ti.get("new_string", "")
    if tool == "MultiEdit":
        return "\n".join(e.get("new_string", "") for e in ti.get("edits", []) or [])
    return ""


def old_content(tool: str, ti: dict, r: str) -> str:
    if tool == "Edit":
        return ti.get("old_string", "")
    if tool == "MultiEdit":
        return "\n".join(e.get("old_string", "") for e in ti.get("edits", []) or [])
    fp = root() / r
    return fp.read_text(encoding="utf-8", errors="ignore") if fp.exists() else ""


APPROVAL_RE = re.compile(r"^\s*status\s*:\s*[\"']?(approved|done)\b", re.M)


def run(data: dict):
    cfg = config()
    enf = cfg["enforcement"]
    tool, ti = data.get("tool_name", ""), data.get("tool_input", {}) or {}

    if tool == "Bash":
        check_bash(ti.get("command", ""), cfg, enf)
        return

    path = ti.get("file_path") or ti.get("notebook_path")
    if not path:
        return
    r = rel(path)

    if is_protected(r, cfg):
        decide_pre(enf["protect"], f"ハーネス保護対象 {r} の変更です。ルールを弱める変更でないか確認してください。")
        return

    # 要件の承認はユーザーが行う
    if r.startswith(cfg["docs"]["requirements"] + "/") and APPROVAL_RE.search(new_content(tool, ti)) \
            and not APPROVAL_RE.search(old_content(tool, ti, r)):
        decide_pre(enf.get("approval", "ask"),
                   f"{r} を承認済み（approved/done）にしようとしています。要件の承認はユーザーが行います。"
                   "内容（関心事・業務ルール・受入基準・open_questions が空）をユーザーが確認したうえで許可してください。")
        return

    if not is_source(r, cfg):
        return  # テスト・ドキュメント・設定ファイルは常に書ける（テスト先行歓迎）

    reqs = load_requirements(cfg)
    if not any(is_approved(d) for _, d in reqs):
        decide_pre(enf["phase_gate"], "工程ゲート(01 要件定義): 承認済み（status: approved かつ open_questions 無し）の要件がありません。/p1-req を先に。")
        return
    if not (load_model(cfg).get("terms")):
        decide_pre(enf["phase_gate"], f"工程ゲート(02 モデル): {cfg['docs']['model']} に用語がありません。/p2-model を先に。")
        return

    if layer_of(r, cfg) == "domain":
        lg = L.lang_of(r, cfg.get("languages") or None)
        fp = root() / r
        existing = fp.read_text(encoding="utf-8", errors="ignore") if fp.exists() else ""
        before = set(L.type_names(existing, lg, top_level_only=True)) if existing else set()
        if tool == "Write":
            added = [n for n in L.type_names(new_content(tool, ti), lg, top_level_only=True) if n not in before]
        else:  # Edit は断片なので入れ子判定ができない。既存ファイルに無い型だけを対象にする
            added = [n for n in L.type_names(new_content(tool, ti), lg) if n not in set(L.type_names(existing, lg))]
            added = [n for n in added if not re.search(rf"^\s+(?:private|protected|internal)?\s*(?:static\s+)?(?:final\s+)?"
                                                        rf"(?:class|record|enum|interface|struct)\s+{n}\b", new_content(tool, ti), re.M)]
        names = glossary_names(cfg)
        unknown = [n for n in added if not name_allowed(n, names, cfg)]
        if unknown:
            decide_pre(enf["model_first"],
                       f"モデル先行(P23): {', '.join(unknown)} は用語集（{cfg['docs']['model']}）にありません。"
                       "業務の言葉として定義（name_ja / kind / definition）してから作成してください。"
                       "既存用語の言い換えなら既存の名前を使ってください。（入れ子の補助型は対象外）")
