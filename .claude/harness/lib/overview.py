"""全体俯瞰ドキュメント（P34）：用語集・要件・テストの紐付けから docs/overview.md を生成する"""
from __future__ import annotations

import datetime
import re

from .core import config, root
from .trace import check, is_approved, load_model, load_requirements, phase

CAT_LABEL = {"hito": "ヒト", "mono": "モノ", "koto": "コト"}


def _id(name: str) -> str:
    return re.sub(r"\W", "_", name or "X")


def build() -> str:
    cfg = config()
    res = check(False)
    model = load_model(cfg)
    terms = model.get("terms", []) or []
    by_ja = {t.get("name_ja"): t for t in terms}
    reqs = load_requirements(cfg)
    s = res.stats
    out = [f"# 全体俯瞰（{model.get('context', '')}）", "",
           f"> 生成: `harness overview` / {datetime.date.today()}。手で編集しない（用語集・要件・テストから再生成する）。", "",
           "## 進捗", "",
           f"- 工程: **{phase(res)}**",
           f"- 要件: {s['approved']} / {s['requirements']} 承認",
           f"- 受入基準: {s['ac_linked']} / {s['acceptance_criteria']} がテストで検証済み"
           + (f"（{round(100 * s['ac_linked'] / s['acceptance_criteria'])}%）" if s["acceptance_criteria"] else ""),
           f"- 非機能要件（テスト検証）: {s.get('nfr_linked', 0)} / {s.get('nfr_tests', 0)}",
           f"- 用語: {s['terms']} / ドメインの型: {s['domain_types']}",
           f"- 整合性: エラー {len(res.errors)} / 警告 {len(res.warnings)}", ""]

    # ドメインモデル図（ヒト・モノ・コト）
    out += ["## ドメインモデル", "", "```mermaid", "classDiagram"]
    for cat in ("koto", "hito", "mono", None):
        group = [t for t in terms if t.get("category") == cat] if cat else \
            [t for t in terms if t.get("category") not in CAT_LABEL]
        for t in group:
            cid = _id(t.get("code_name") or t.get("name_ja"))
            out.append(f"  class {cid}[\"{t.get('name_ja', '')}\"] {{")
            stereo = CAT_LABEL.get(t.get("category"), "") + (" " if t.get("category") else "") + (t.get("kind") or "")
            out.append(f"    <<{stereo.strip() or '未分類'}>>")
            for b in (t.get("behaviors") or [])[:6]:
                out.append(f"    +{re.sub(r'[{}()<>]', '', str(b))}()")
            out.append("  }")
    seen = set()
    for t in terms:
        a = _id(t.get("code_name") or t.get("name_ja"))
        for r in t.get("related") or []:
            if r in by_ja:
                b = _id(by_ja[r].get("code_name") or r)
                if (b, a) not in seen:
                    out.append(f"  {a} --> {b}")
                    seen.add((a, b))
    out += ["```", ""]

    # コトの約束
    kotos = [t for t in terms if t.get("category") == "koto"]
    if kotos:
        out += ["## コトと約束", "", "| コト | 約束すること | 約束しないこと |", "|---|---|---|"]
        for t in kotos:
            pr = t.get("promises") or {}
            out.append(f"| {t.get('name_ja')} | {'<br>'.join(pr.get('do') or []) if isinstance(pr, dict) else pr} | "
                       f"{'<br>'.join(pr.get('dont') or []) if isinstance(pr, dict) else ''} |")
        out.append("")

    # 状態遷移
    for t in terms:
        if t.get("kind") == "state" and t.get("transitions"):
            names = {v.get("code"): v.get("name_ja", v.get("code")) for v in t.get("values") or []}
            out += [f"### 状態遷移: {t.get('name_ja')}", "", "```mermaid", "stateDiagram-v2"]
            first = next(iter(t["transitions"]))
            out.append(f"  [*] --> {first}")
            for c, n in names.items():
                out.append(f"  {c} : {n}")
            for src, dsts in t["transitions"].items():
                for d in dsts or []:
                    out.append(f"  {src} --> {d}")
            out += ["```", ""]

    # 要件 × 受入基準 × テスト
    out += ["## 要件とテストの対応", "", "| 要件 | 状態 | 受入基準 | テスト |", "|---|---|---|---|"]
    for _, d in reqs:
        for i, ac in enumerate(d.get("acceptance_criteria") or []):
            mark = "✅" if ac.get("id") in res.linked else "—"
            head = f"{d.get('id')} {d.get('title', '')}" if i == 0 else ""
            st = ("承認" if is_approved(d) else d.get("status", "")) if i == 0 else ""
            out.append(f"| {head} | {st} | {ac.get('id')} {str(ac.get('then', ''))[:40]} | {mark} |")
    out.append("")
    if res.errors:
        out += ["## 未解決の整合性エラー", ""] + [f"- {e}" for e in res.errors[:30]] + [""]
    return "\n".join(out)


def run() -> int:
    p = root() / "docs" / "overview.md"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(build(), encoding="utf-8")
    print(f"{p.relative_to(root())} を生成しました")
    return 0
