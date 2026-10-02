"""設定・パス・ファイル分類・フック入出力"""
from __future__ import annotations

import copy
import json
import os
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:  # pragma: no cover
    sys.stderr.write("[harness] PyYAML が必要です: pip install pyyaml\n")
    sys.exit(0)  # フックを壊さない

HARNESS_DIR = Path(__file__).resolve().parent.parent


# ---------------- パス ----------------
def root() -> Path:
    return Path(os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()).resolve()


def rel(path) -> str:
    p = Path(path)
    if not p.is_absolute():
        p = root() / p
    try:
        return p.resolve().relative_to(root()).as_posix()
    except ValueError:
        return p.as_posix()


_GLOB_CACHE: dict[str, re.Pattern] = {}


def _glob_re(pat: str) -> re.Pattern:
    if pat not in _GLOB_CACHE:
        out, i = "", 0
        while i < len(pat):
            if pat.startswith("**/", i):
                out += "(?:.*/)?"; i += 3
            elif pat.startswith("**", i):
                out += ".*"; i += 2
            elif pat[i] == "*":
                out += "[^/]*"; i += 1
            elif pat[i] == "?":
                out += "[^/]"; i += 1
            else:
                out += re.escape(pat[i]); i += 1
        _GLOB_CACHE[pat] = re.compile(out + r"\Z")
    return _GLOB_CACHE[pat]


def gmatch(path: str, pat: str) -> bool:
    """gitignore 風 glob（** は 0 個以上のディレクトリ）"""
    return _glob_re(pat).match(path) is not None


# ---------------- 設定 ----------------
def _merge(a: dict, b: dict) -> dict:
    out = copy.deepcopy(a)
    for k, v in (b or {}).items():
        out[k] = _merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


_CFG = None


def config() -> dict:
    global _CFG
    if _CFG is None:
        base = yaml.safe_load((HARNESS_DIR / "defaults.yaml").read_text(encoding="utf-8"))
        proj = root() / "harness.yaml"
        _CFG = _merge(base, yaml.safe_load(proj.read_text(encoding="utf-8")) or {}) if proj.exists() else base
        for prof in _CFG.get("profiles") or []:
            pp = HARNESS_DIR / "rules" / "profiles" / f"{prof}.yaml"
            if pp.exists():
                _CFG["limits"] = _merge(_CFG["limits"], (yaml.safe_load(pp.read_text(encoding="utf-8")) or {}).get("limits") or {})
    return _CFG


def load_yaml(p: Path):
    return yaml.safe_load(p.read_text(encoding="utf-8")) or {}


# ---------------- ファイル分類 ----------------
def is_excluded(r: str, cfg: dict) -> bool:
    parts = r.split("/")[:-1]
    return any(p in cfg["source"]["exclude_dirs"] for p in parts)


def is_test(r: str, cfg: dict) -> bool:
    return any(gmatch(r, p) for p in cfg["source"]["test_patterns"])


def is_migration(r: str, cfg: dict) -> bool:
    return r.endswith(".sql") and any(gmatch(r, p) for p in cfg["source"]["migration_patterns"])


def layer_of(r: str, cfg: dict) -> str | None:
    """paths(glob) が最優先。次に domain のディレクトリ名があれば domain（domain/service 等を誤判定しない）。
    それ以外は最も深いディレクトリ名で判定（api/ 配下の domain など、上位の名前に引きずられない）"""
    arch = cfg["architecture"]
    for name, spec in arch["layers"].items():
        if any(gmatch(r, p) for p in spec.get("paths", []) or []):
            return name
    parts = [p.lower() for p in re.split(r"[/\\]", r)[:-1]]
    dom = {s.lower() for s in (arch["layers"].get("domain", {}).get("segments") or [])}
    if dom & set(parts):
        return "domain"
    best, best_idx = None, -1
    for name, spec in arch["layers"].items():
        segs = {s.lower() for s in spec.get("segments", []) or []}
        for i, p in enumerate(parts):
            if p in segs and i > best_idx:
                best, best_idx = name, i
    return best


def is_gate_exempt(r: str, cfg: dict) -> bool:
    return any(gmatch(r, p) for p in cfg["source"].get("gate_exempt_patterns") or [])


def resolve_alias(imp: str, cfg: dict) -> str | None:
    """エイリアス付き import を実パスに（該当しなければ None）"""
    for alias, target in sorted((cfg["architecture"].get("aliases") or {}).items(), key=lambda x: -len(x[0])):
        if imp.startswith(alias):
            return target.rstrip("/") + "/" + imp[len(alias):]
    return None


def walk_files(base: Path | None = None):
    cfg = config()
    base = base or root()
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = [d for d in dirnames if d not in cfg["source"]["exclude_dirs"] and not d.startswith(".")]
        for f in filenames:
            yield Path(dirpath) / f


# ---------------- フック出力 ----------------
def read_input() -> dict:
    raw = sys.stdin.read()
    return json.loads(raw) if raw.strip() else {}


def emit(obj: dict):
    print(json.dumps(obj, ensure_ascii=False))
    sys.exit(0)


PENDING = ".harness/pending_warnings.txt"


def add_pending(msg: str):
    p = root() / PENDING
    p.parent.mkdir(exist_ok=True)
    with p.open("a", encoding="utf-8") as f:
        f.write(msg + "\n")


def pop_pending() -> list[str]:
    p = root() / PENDING
    if not p.exists():
        return []
    lines = [l for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]
    p.unlink()
    return lines


def decide_pre(mode: str, reason: str):
    """PreToolUse の判定を enforcement モードに従って返す"""
    if mode == "off":
        return
    if mode == "warn":
        add_pending(reason)
        return
    emit({"hookSpecificOutput": {"hookEventName": "PreToolUse",
                                 "permissionDecision": "deny" if mode == "deny" else "ask",
                                 "permissionDecisionReason": reason}})
