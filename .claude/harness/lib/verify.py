"""全検証を実行し .harness/last_verify.json に記録（リリースゲートが参照）"""
from __future__ import annotations

import datetime
import json
import os
import subprocess
import sys

from .core import config, root


def _git(*args) -> str:
    try:
        return subprocess.check_output(["git", *args], cwd=root(), text=True, stderr=subprocess.DEVNULL).strip()
    except Exception:
        return ""


def run(harness_cmd: list[str]) -> int:
    cfg = config()
    R = root()
    (R / ".harness").mkdir(exist_ok=True)
    head = _git("rev-parse", "HEAD") or "none"
    # 未追跡ファイル（.gitignore 対象外）も未コミットとみなす：コミットされないソースで検証が通るのを防ぐ
    dirty = bool(_git("status", "--porcelain"))
    steps = [{"name": "harness check --strict", "run": " ".join(harness_cmd + ["check", "--strict"]), "cwd": "."}]
    steps += cfg["verify"].get("steps") or []
    failed = None
    for s in steps:
        cwd = R / s.get("cwd", ".")
        print(f"==> {s['name']}  ({s.get('cwd', '.')}: {s['run']})", flush=True)
        env = {**os.environ, "CI": "true", **(s.get("env") or {})}
        if subprocess.run(s["run"], shell=True, cwd=cwd, env=env).returncode != 0:
            failed = s["name"]
            break
    stamp = {"head": head, "passed": failed is None, "dirty": dirty, "failed_step": failed or "",
             "at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")}
    (R / ".harness" / "last_verify.json").write_text(json.dumps(stamp, ensure_ascii=False), encoding="utf-8")
    if failed:
        print(f"FAILED: {failed}")
        return 1
    print(f"ALL GREEN  head={head[:10]} dirty={dirty}")
    if dirty:
        print("※ 未コミットの変更あり。リリースゲートは通りません。コミット後に再実行してください。")
    if not cfg["verify"].get("steps"):
        print("※ verify.steps が空です。harness.yaml にビルド/テストコマンドを設定してください。", file=sys.stderr)
    return 0
