"""トレーサビリティ：要件 ⇄ 用語集 ⇄ 設計 ⇄ コード ⇄ テスト、用語ドリフト"""
from __future__ import annotations

import re
from pathlib import Path

from . import lang as L
from .core import config, is_gate_exempt, is_test, layer_of, load_yaml, rel, root, walk_files

KINDS = {"value", "entity", "aggregate", "collection", "kubun", "state", "rule", "service", "event"}
AC_RE = re.compile(r"AC-\d{3}-\d{2}")
NFR_RE = re.compile(r"NFR-\d{3}-\d{2}")
CATEGORIES = {"hito", "mono", "koto"}


class Result:
    def __init__(self):
        self.errors, self.warnings, self.stats = [], [], {}

    def add(self, strict_only, msg, strict):
        (self.errors if (strict or not strict_only) else self.warnings).append(msg)


def load_model(cfg) -> dict:
    p = root() / cfg["docs"]["model"]
    return load_yaml(p) if p.exists() else {}


def load_requirements(cfg) -> list[tuple[Path, dict]]:
    d = root() / cfg["docs"]["requirements"]
    return [(p, load_yaml(p)) for p in sorted(d.glob("REQ-*.y*ml"))] if d.exists() else []


def is_approved(d: dict) -> bool:
    return (d or {}).get("status") in ("approved", "done") and not (d or {}).get("open_questions")


def glossary_names(cfg) -> set[str]:
    names = set()
    for t in load_model(cfg).get("terms", []) or []:
        if t.get("code_name"):
            names.add(t["code_name"])
        names |= set(t.get("code_aliases") or [])
    return names


def name_allowed(name: str, names: set[str], cfg) -> bool:
    g = cfg["glossary"]
    if name in names or name in (g.get("allow_names") or []) or name.startswith("_"):
        return True
    return any(name.endswith(s) and name[: -len(s)] in names for s in g.get("allow_suffixes") or [])


def domain_types(cfg) -> dict[str, str]:
    """domain レイヤの型名 → ファイル"""
    out = {}
    for p in walk_files():
        r = rel(p)
        lg = L.lang_of(r, cfg.get("languages") or None)
        if not lg or is_test(r, cfg) or layer_of(r, cfg) != "domain":
            continue
        if is_gate_exempt(r, cfg):
            continue
        for n in L.type_names(p.read_text(encoding="utf-8", errors="ignore"), lg, top_level_only=True):
            out.setdefault(n, r)
    return out


def check(strict=False) -> Result:
    cfg, res, R = config(), Result(), root()
    reqs = load_requirements(cfg)
    model = load_model(cfg)
    terms = model.get("terms", []) or []
    by_ja = {t.get("name_ja"): t for t in terms}

    # ---- 要件 ----
    all_ac, all_nfr = {}, {}
    for p, d in reqs:
        f, rid = rel(p), d.get("id")
        if not rid or p.stem != rid:
            res.errors.append(f"[REQ] {f}: id とファイル名が一致しない")
        if not d.get("concerns"):
            res.errors.append(f"[P22] {f}: concerns（業務の関心事）が空")
        acs = d.get("acceptance_criteria") or []
        if not acs:
            res.errors.append(f"[REQ] {f}: acceptance_criteria が空")
        for ac in acs:
            if not AC_RE.fullmatch(str(ac.get("id", ""))) or not all(ac.get(k) for k in ("given", "when", "then")):
                res.errors.append(f"[REQ] {f}: 受入基準 {ac.get('id')} は AC-000-00 形式で given/when/then 必須")
            else:
                all_ac[ac["id"]] = (rid, is_approved(d))
        for nf in d.get("non_functional") or []:
            if isinstance(nf, str):
                res.warnings.append(f"[P34] {f}: 非機能要件 '{nf[:20]}…' に id（NFR-000-00）と verify_by が無い")
                continue
            if not NFR_RE.fullmatch(str(nf.get("id", ""))) or nf.get("verify_by") not in ("test", "monitoring", "review"):
                res.errors.append(f"[P34] {f}: 非機能要件 {nf.get('id')} は NFR-000-00 形式、verify_by は test|monitoring|review")
            elif nf["verify_by"] == "test":
                all_nfr[nf["id"]] = (rid, is_approved(d))
        for br in d.get("business_rules") or []:
            for t in br.get("terms") or []:
                if t not in by_ja:
                    res.add(False, f"[P23] {f}: {br.get('id')} の用語 '{t}' が {cfg['docs']['model']} に無い", strict)
        if d.get("status") in ("approved", "done") and d.get("open_questions"):
            res.errors.append(f"[REQ] {f}: open_questions が残ったまま {d.get('status')}")
        if is_approved(d) and not (R / cfg["docs"]["design"] / f"{rid}.md").exists():
            res.add(True, f"[P15] {rid}: 設計書 {cfg['docs']['design']}/{rid}.md が無い（/p3-design）", strict)

    # ---- 用語集 ----
    for t in terms:
        name = t.get("name_ja") or t.get("code_name")
        missing = [k for k in ("name_ja", "code_name", "kind", "definition") if not t.get(k)]
        if missing:
            (res.warnings if t.get("todo") else res.errors).append(
                f"[P23] 用語集: '{name}' に {', '.join(missing)} が無い" + ("（todo）" if t.get("todo") else ""))
        k = t.get("kind")
        if k and k not in KINDS:
            res.errors.append(f"[P23] 用語集: '{name}' の kind '{k}' は {sorted(KINDS)} のいずれか")
        if k == "value" and not t.get("invariants"):
            res.warnings.append(f"[P07] 用語集: 値 '{name}' に invariants（生成時に守る条件）が無い")
        if k in ("entity", "aggregate") and not t.get("identity"):
            res.warnings.append(f"[P23] 用語集: '{name}' に identity（同一性の根拠）が無い")
        if k in ("kubun", "state"):
            codes = {v.get("code") for v in t.get("values") or []}
            if not codes:
                res.errors.append(f"[P09] 用語集: '{name}' に values が無い")
            if k == "kubun" and not t.get("behaviors"):
                res.warnings.append(f"[P09] 用語集: 区分 '{name}' に behaviors（区分ごとに変わる振る舞い）が無い")
            if k == "state":
                tr = t.get("transitions") or {}
                if not tr:
                    res.errors.append(f"[P10] 用語集: 状態 '{name}' に transitions が無い")
                for s, dsts in tr.items():
                    for x in [s, *(dsts or [])]:
                        if x not in codes:
                            res.errors.append(f"[P10] 用語集: 状態 '{name}' の遷移に未定義コード '{x}'")
        if k in ("entity", "aggregate", "event") and t.get("category") not in CATEGORIES:
            res.warnings.append(f"[P29] 用語集: '{name}' に category（hito / mono / koto）が無い")
        if t.get("category") == "koto" and not t.get("promises"):
            res.warnings.append(f"[P29] 用語集: コト '{name}' に promises（約束すること・しないこと）が無い")
        for r2 in t.get("related") or []:
            if r2 not in by_ja:
                res.warnings.append(f"[P23] 用語集: '{name}' の related '{r2}' が未定義")

    if len(terms) >= 3 and not any(t.get("category") == "koto" for t in terms):
        res.warnings.append("[P29] 用語集: コト（取引・約束・出来事）が1つも無い。業務ルールはコトに集まる。注文・契約・予約・支払などを探す")

    # ---- コード ⇄ 用語集 ----
    names = glossary_names(cfg)
    dtypes = domain_types(cfg)
    for n, f in dtypes.items():
        if not name_allowed(n, names, cfg):
            res.errors.append(f"[P23] {f}: 型 '{n}' が用語集に無い（モデルとコードの乖離。/p2-model か harness scaffold-model）")
    if dtypes:
        for t in terms:
            if t.get("kind") not in ("rule", "service", "event") and t.get("code_name") and t["code_name"] not in dtypes:
                res.warnings.append(f"[P22] 用語集: '{t.get('name_ja')}'({t['code_name']}) の実装がまだ無い")

    # ---- テスト ⇄ 受入基準 ----
    linked, linked_nfr = set(), set()
    for p in walk_files():
        r = rel(p)
        if is_test(r, cfg) and L.lang_of(r):
            txt = p.read_text(encoding="utf-8", errors="ignore")
            linked |= set(AC_RE.findall(txt))
            linked_nfr |= set(NFR_RE.findall(txt))
    for n_id, (rid, ok) in all_nfr.items():
        if ok and n_id not in linked_nfr:
            res.add(True, f"[P34] 非機能要件 {n_id}（{rid}）を検証するテストが無い（非機能要件はテストコードで表現する）", strict)
    for a, (rid, ok) in all_ac.items():
        if ok and a not in linked:
            res.add(True, f"[P24] 受入基準 {a}（{rid}）を検証するテストが無い（テスト名/タグに {a} を含める）", strict)
    for a in sorted(linked - set(all_ac)):
        res.warnings.append(f"[P24] テストが存在しない受入基準 {a} を参照している")

    # ---- 用語ドリフト ----
    avoid = {w: t.get("name_ja") for t in terms for w in (t.get("avoid") or [])}
    if avoid:
        hits = 0
        tpl = ".claude/"
        for p in walk_files():
            r = rel(p)
            if r == cfg["docs"]["model"] or r.startswith(tpl):
                continue
            if not (L.lang_of(r) or r.endswith((".md", ".yaml", ".yml"))):
                continue
            for n, line in enumerate(p.read_text(encoding="utf-8", errors="ignore").split("\n"), 1):
                for w, good in avoid.items():
                    if hits < 30 and re.search(rf"(?<![A-Za-z0-9]){re.escape(w)}(?![a-z0-9])", line):
                        res.warnings.append(f"[P23] 用語ドリフト {r}:{n} '{w}' → '{good}'")
                        hits += 1
    # docs 走査（walk_files は docs を除外するため別途）
    if avoid:
        for p in (R / "docs").rglob("*") if (R / "docs").exists() else []:
            r = rel(p)
            if p.suffix not in (".md", ".yaml", ".yml") or r == cfg["docs"]["model"]:
                continue
            for n, line in enumerate(p.read_text(encoding="utf-8", errors="ignore").split("\n"), 1):
                for w, good in avoid.items():
                    if hits < 30 and re.search(rf"(?<![A-Za-z0-9]){re.escape(w)}(?![a-z0-9])", line):
                        res.warnings.append(f"[P23] 用語ドリフト {r}:{n} '{w}' → '{good}'")
                        hits += 1

    res.stats = {"requirements": len(reqs), "approved": sum(1 for _, d in reqs if is_approved(d)),
                 "terms": len(terms), "acceptance_criteria": len(all_ac),
                 "ac_linked": len(set(all_ac) & linked), "domain_types": len(dtypes),
                 "nfr_tests": len(all_nfr), "nfr_linked": len(set(all_nfr) & linked_nfr)}
    res.linked, res.linked_nfr = linked, linked_nfr
    return res


def phase(res: Result) -> str:
    s = res.stats
    if s["approved"] == 0:
        return "01 要件定義（/p1-req）"
    if s["terms"] == 0:
        return "02 ドメインモデリング（/p2-model）"
    if any("設計書" in m for m in res.errors + res.warnings):
        return "03 設計（/p3-design）"
    if s["domain_types"] == 0 or any("実装がまだ無い" in m for m in res.warnings):
        return "04 実装（/p4-impl）"
    if s["ac_linked"] < s["acceptance_criteria"]:
        return "05 テスト（/p5-test）"
    return "06 リリース準備可（/p6-release）"
