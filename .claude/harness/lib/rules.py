"""ルールエンジン：rules/*.yaml（言語パック）+ 組み込みチェック + アーキテクチャ検査"""
from __future__ import annotations

import hashlib
import json
import posixpath
import re
from dataclasses import dataclass
from pathlib import Path

from . import lang as L
from .core import (HARNESS_DIR, config, is_excluded, is_gate_exempt, is_migration, is_test, layer_of, load_yaml, rel,
                   resolve_alias, root)

ALLOW_RE = re.compile(r"harness-allow:\s*((?:P\d+[ ,]*)+).*?(ADR-\d+)")
ALLOW_FILE_RE = re.compile(r"harness-allow-file:\s*((?:P\d+[ ,]*)+).*?(ADR-\d+)")


@dataclass
class Finding:
    rule: str
    principle: str
    severity: str  # error | warn
    path: str
    line: int
    message: str
    text: str = ""

    def fingerprint(self) -> str:
        h = hashlib.sha1(re.sub(r"\s+", " ", self.text.strip()).encode()).hexdigest()[:12]
        return f"{self.path}|{self.rule}|{h}"

    def __str__(self):
        tag = "ERROR" if self.severity == "error" else "WARN "
        return f"{tag} [{self.principle}] {self.path}:{self.line} {self.message}"


_PACKS = None


def packs() -> dict[str, dict]:
    global _PACKS
    if _PACKS is None:
        _PACKS = {}
        files = sorted((HARNESS_DIR / "rules").glob("*.yaml"))
        files += [HARNESS_DIR / "rules" / "profiles" / f"{x}.yaml" for x in config().get("profiles") or []]
        d = root() / ".harness-rules"  # プロジェクト独自ルール
        files += sorted(d.glob("*.yaml")) if d.exists() else []
        for p in files:
            if p.exists():
                data = load_yaml(p)
                _PACKS.setdefault("_overrides", {}).update(data.get("severity_overrides") or {})
                name = data.get("language", p.stem)
                cur = _PACKS.setdefault(name, {"rules": [], "domain_forbidden_imports": []})
                cur["rules"] += data.get("rules", []) or []
                cur["domain_forbidden_imports"] += data.get("domain_forbidden_imports", []) or []
    return _PACKS


def baseline() -> set[str]:
    p = root() / ".harness-baseline.json"
    return set(json.loads(p.read_text(encoding="utf-8"))) if p.exists() else set()


# ---------------- ルール適用 ----------------
_ADRS = None


def adr_exists(adr_id: str) -> bool:
    """harness-allow が参照する ADR が docs/adr に実在するか（無い ADR 番号での抑止は無効）"""
    global _ADRS
    if _ADRS is None:
        d = root() / config()["docs"]["adr"]
        _ADRS = {m.group(0) for p in (d.glob("*.md") if d.exists() else []) if (m := re.search(r"ADR-\d+", p.name))}
    num = re.sub(r"\D", "", adr_id)
    return any(re.sub(r"\D", "", a).lstrip("0") == num.lstrip("0") for a in _ADRS)


def _allow_principles(m) -> set[str]:
    return set(re.findall(r"P\d+", m.group(1))) if m and adr_exists(m.group(2)) else set()


def _suppressed(raw_lines, idx, principle, file_allow):
    if principle in file_allow:
        return True
    for k in (idx, idx - 1):
        if 0 <= k < len(raw_lines) and principle in _allow_principles(ALLOW_RE.search(raw_lines[k])):
            return True
    return False


def invalid_allows(r: str, src: str) -> list[Finding]:
    """実在しない ADR を参照している harness-allow を報告する"""
    out = []
    for i, l in enumerate(src.split("\n"), 1):
        for rx in (ALLOW_RE, ALLOW_FILE_RE):
            m = rx.search(l)
            if m and not adr_exists(m.group(2)):
                out.append(Finding("harness.allow-without-adr", "P35", "error", r, i,
                                   f"{m.group(2)} が {config()['docs']['adr']} にありません。ADR を書いてから例外にする（この例外は無効）", l))
    return out


def apply_rules(r: str, src: str, lg: str, layer: str | None, cfg: dict) -> list[Finding]:
    code = L.scan(src, lg)
    code_lines, raw_lines = code.split("\n"), src.split("\n")
    dep = L.depths(code)
    file_allow = {p for m in ALLOW_FILE_RE.finditer(src) for p in _allow_principles(m)}
    limits = cfg["limits"]
    out = []
    rule_list = (packs().get(lg, {}).get("rules", []) or []) + (packs().get("common", {}).get("rules", []) or [])
    for rule in rule_list:
        langs = rule.get("languages")
        if langs and lg not in langs:
            continue
        if rule.get("layers") and layer not in rule["layers"]:
            continue
        if rule.get("exclude_file_if") and re.search(rule["exclude_file_if"], code, re.M):
            continue
        req = rule.get("file_requires")
        if req:
            n = sum(1 for i, l in enumerate(code_lines) if re.search(req["pattern"], l)
                    and (not req.get("member_of") or (dep[i][0] == 1 and re.search(req["member_of"], dep[i][1]))))
            if n < req.get("min", 1):
                continue
        target = raw_lines if rule.get("target") == "raw" else code_lines
        hits = []
        for i, l in enumerate(target):
            if not re.search(rule["pattern"], l):
                continue
            if rule.get("unless_line") and re.search(rule["unless_line"], l):
                continue
            if rule.get("member_of"):
                d, opener = dep[i]
                if d != 1 or not re.search(rule["member_of"], opener):
                    continue
            if rule.get("outside_funcs"):
                fn = L.enclosing_func(code_lines, i, lg)
                if fn in rule["outside_funcs"]:
                    continue
            hits.append(i)
        total = len(hits)
        if rule.get("count_over"):
            hits = hits[:1] if len(hits) > limits.get(rule["count_over"], 0) else []
        if rule.get("max_hits"):
            hits = hits[: rule["max_hits"]]
        sev = packs().get("_overrides", {}).get(rule["id"], rule.get("severity", "warn"))
        for i in hits:
            if _suppressed(raw_lines, i, rule["principle"], file_allow):
                continue
            msg = rule["message"].replace("{count}", str(total))
            out.append(Finding(rule["id"], rule["principle"], sev, r, i + 1, msg, raw_lines[i]))
    out += builtin_checks(r, src, code, lg, layer, cfg, raw_lines, file_allow)
    return out


def builtin_checks(r, src, code, lg, layer, cfg, raw_lines, file_allow) -> list[Finding]:
    out, limits = [], cfg["limits"]

    def add(rule, pid, sev, line, msg):
        if not _suppressed(raw_lines, line - 1, pid, file_allow):
            out.append(Finding(rule, pid, sev, r, line, msg, raw_lines[line - 1] if line - 1 < len(raw_lines) else ""))

    # P01 曖昧な型名
    vague = ("Manager", "Util", "Utils", "Helper", "Helpers", "Info", "Data", "Processor", "Common", "Misc")
    for name in L.type_names(src, lg):
        if name.endswith(vague) and name not in vague:
            line = next((i for i, l in enumerate(code.split("\n"), 1) if re.search(rf"\b{name}\b", l)), 1)
            add("builtin.vague-name", "P01", "warn", line, f"型名 '{name}' が曖昧。業務の人がそれを何と呼ぶかで名付ける")
    # P02 長さ
    nonblank = len([l for l in code.split("\n") if l.strip()])
    lim = limits["app_file_lines"] if layer == "application" else limits["file_lines"]
    if nonblank > lim:
        add("builtin.file-length", "P15" if layer == "application" else "P02", "warn", 1,
            f"{nonblank} 行（上限 {lim}）。関心事・ユースケース単位に分割できないか")
    for start, name, n in L.functions(code, lg):
        if n > limits["function_lines"]:
            add("builtin.function-length", "P02", "warn", start, f"{name} が {n} 行。目的ごとの小さな関数に分ける")
    # P25 引数の数 / P26 ネストの深さ
    code_lines = code.split("\n")
    for start, name, n in L.functions(code, lg):
        params = _params(code_lines, start - 1, lg)
        if params > limits["params_warn"]:
            add("builtin.too-many-params", "P25", "warn", start,
                f"{name} の引数が {params} 個。関連する引数を値オブジェクトにまとめられないか（関心事が混ざっていないか）")
        depth, at = _max_nesting(code_lines, start - 1, n, lg)
        if depth > limits["nesting_depth"]:
            add("builtin.nesting", "P26", "warn", at,
                f"{name} のネストが {depth} 段。早期リターン（ガード節）や判断メソッドの抽出で浅くする")
    # P28 技術的な種別でのパッケージ分け
    if layer == "domain":
        parts = [x.lower() for x in r.split("/")[:-1]]
        tech = set(cfg.get("technical_package_names") or [])
        if "domain" in parts:
            below = parts[parts.index("domain") + 1:]
            bad = [x for x in below if x in tech]
            if bad:
                add("builtin.package-by-type", "P28", "warn", 1,
                    f"domain 配下のパッケージ '{bad[0]}' は技術的な種別。業務の関心事（注文・請求…）で分ける")
    # P05 基本データ型への執着（domain）
    if layer == "domain" and L.LANGS[lg]["primitives"]:
        prims = set(L.LANGS[lg]["primitives"])
        for i, l in enumerate(code.split("\n"), 1):
            if not re.search(L.LANGS[lg]["func"], l):
                continue
            m = re.search(r"\(([^)]*)\)", l)
            if not m:
                continue
            found = [t for t in re.findall(r"[A-Za-z_][\w.]*", m.group(1)) if t in prims]
            if len(found) >= limits["primitive_params_warn"]:
                add("builtin.primitive-params", "P05", "warn", i,
                    f"基本データ型の引数が {len(found)} 個（{', '.join(found)}）。値オブジェクトにできないか")
    return out


def _params(lines, i, lg) -> int:
    buf = " ".join(lines[i:i + 6])
    k = buf.find("(")
    if k < 0:
        return 0
    depth, j, inner = 0, k, ""
    while j < len(buf):
        c = buf[j]
        depth += c in "([{<"
        depth -= c in ")]}>"
        if depth == 0:
            break
        if depth == 1 and c not in "(":
            inner += c
        elif depth > 1:
            inner += " "
        j += 1
    items = [x.strip() for x in inner.split(",") if x.strip()]
    items = [x for x in items if x not in ("self", "cls") and not x.startswith(("self:", "cls:", "*", "&block"))]
    return len(items)


CTRL_RE = re.compile(r"\b(if|for|foreach|while|switch|when|match|try|catch|elif|else|unless|case|loop|select)\b")


def _max_nesting(lines, i, n, lg):
    """関数本体内の制御構造のネスト段数（ラムダ・オブジェクトリテラルは制御構造でない限り数えない）"""
    body = lines[i:i + n]
    best, at = 0, i + 1
    if L.LANGS[lg]["block_style"] == "brace":
        stack, started = [], False
        for k, l in enumerate(body):
            is_ctrl = bool(CTRL_RE.search(l))
            for ch in l:
                if ch == "{":
                    if not started:
                        started = True
                        stack.append(False)
                        continue
                    stack.append(is_ctrl)
                    lvl = sum(stack)
                    if lvl > best:
                        best, at = lvl, i + k + 1
                elif ch == "}" and stack:
                    stack.pop()
    else:
        base = len(body[0]) - len(body[0].lstrip())
        ctrl_indents = []
        for k, l in enumerate(body[1:], 1):
            if not l.strip():
                continue
            ind = len(l) - len(l.lstrip())
            ctrl_indents = [x for x in ctrl_indents if x < ind]
            lvl = len(ctrl_indents)
            if lvl > best:
                best, at = lvl, i + k + 1
            if CTRL_RE.match(l.strip()) and ind > base and not re.match(r"(else|elif|when|case|catch|rescue|except|ensure|finally)\b", l.strip()):
                ctrl_indents.append(ind)
    return best, at


# ---------------- SQL マイグレーション ----------------
VAGUE_COL = re.compile(r'^\s*"?((?:note|notes|memo|remarks?|biko|bikou)\d*|yobi\d*|reserve\d*|extra\d*|free\d*|attr\d*|col\d+|data\d*|misc|others?|option\d*|value\d+|item\d+|info|flag\d*)"?\s', re.I)


def lint_sql(r: str, src: str) -> list[Finding]:
    out, in_table = [], False
    lines = src.split("\n")
    block = ""
    for i, l in enumerate(lines, 1):
        u = l.upper()
        if re.search(r"CREATE\s+TABLE", u):
            in_table = True
            j = i
            while j < len(lines) and not lines[j].strip().startswith(")"):
                j += 1
            block = "\n".join(lines[i:j + 1]).upper()
            continue
        if re.search(r"ALTER\s+TABLE\s+\S+\s+ADD\s+(COLUMN\s+)?(?!CONSTRAINT|INDEX|PRIMARY|FOREIGN|UNIQUE|CHECK)", u):
            out.append(Finding("sql.add-column", "P31", "warn", r, i,
                               "カラム追加。記録のタイミングが違う情報なら、テーブル追加で拡張できないか", l))
        if in_table:
            m = re.match(r'^\s*"?(\w+_id)"?\s', l, re.I)
            if m and "REFERENCES" not in u and "PRIMARY" not in u and \
                    not re.search(rf"FOREIGN\s+KEY\s*\(\s*\"?{m.group(1).upper()}\b", block):
                out.append(Finding("sql.missing-fk", "P17", "warn", r, i,
                                   f"{m.group(1)} に外部キー制約が無い。テーブル間の関係を制約で明示する", l))
            if VAGUE_COL.match(l):
                out.append(Finding("sql.vague-column", "P19", "warn", r, i,
                                   f"用途のわかりにくいカラム: {l.strip()}。何の事実を記録するのか名前で示す（多目的カラムは別テーブルへ）", l))
        if in_table and l.strip().startswith(")"):
            in_table = False
            continue
        if in_table and re.match(r"^\s*\"?\w+\"?\s+\w+", l) and \
                not re.match(r"^\s*(CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK|INDEX|KEY)\b", u):
            if "NOT NULL" not in u and "PRIMARY KEY" not in u and not re.search(r"--\s*NULLABLE:\s*\S", u):
                out.append(Finding("sql.nullable", "P17", "warn", r, i,
                                   f"NULL 許容カラム: {l.strip()}  必要なら `-- nullable: 理由`。多くは別テーブルに分けられる", l))
        if re.match(r"^\s*(UPDATE|DELETE\s+FROM)\b", u):
            out.append(Finding("sql.overwrite", "P18", "warn", r, i, "マイグレーションでの更新/削除。事実を上書きしていないか・ロールバック手順は", l))
        if re.search(r"\b\w+_(FLG|FLAG)\b|\bIS_\w+\s+BOOL", u):
            out.append(Finding("sql.flag", "P09", "warn", r, i, "フラグカラム。区分・状態コードで表現できないか", l))
        if re.search(r"\bDROP\s+(TABLE|COLUMN)\b", u):
            out.append(Finding("sql.drop", "P18", "error", r, i, "DROP を含むマイグレーション。ADR とロールバック手順が必要（harness-allow: P18 ADR-xxxx で許可）", l))
    return out


# ---------------- アーキテクチャ（依存方向） ----------------
def import_layer(imp: str, relative: bool, from_rel: str, lg: str, cfg: dict) -> str | None:
    arch = cfg["architecture"]
    if relative:
        base = posixpath.dirname(from_rel)
        if lg == "python":
            dots = len(imp) - len(imp.lstrip("."))
            for _ in range(dots - 1):
                base = posixpath.dirname(base)
            target = posixpath.join(base, imp.lstrip(".").replace(".", "/"), "x")
        else:
            target = posixpath.normpath(posixpath.join(base, imp)) + "/x"
        return layer_of(target, cfg)
    aliased = resolve_alias(imp, cfg)
    if aliased:
        return layer_of(posixpath.normpath(aliased) + "/x", cfg)
    prefixes = arch.get("internal_prefixes") or []
    if prefixes and not any(imp.startswith(p) for p in prefixes):
        return None
    path = re.sub(r"[.\\:]+|::", "/", imp.lstrip("@~/")) + "/x"
    return layer_of(path, cfg)


def check_arch(r: str, src: str, lg: str, layer: str | None, cfg: dict) -> list[Finding]:
    if not cfg["architecture"].get("enabled", True) or not layer:
        return []
    out, raw = [], src.split("\n")
    allowed = set(cfg["architecture"]["allowed"].get(layer, [])) | {layer}
    forbidden = packs().get(lg, {}).get("domain_forbidden_imports", []) if layer == "domain" else []
    for line, imp, relative in L.imports(src, lg):
        if any("P16" in _allow_principles(ALLOW_RE.search(raw[k])) for k in (line - 1, line - 2) if 0 <= k < len(raw)):
            continue
        tgt = import_layer(imp, relative, r, lg, cfg)
        if tgt and tgt not in allowed:
            out.append(Finding("arch.layer", "P16", "error", r, line,
                               f"{layer} → {tgt} の依存は禁止（許可: {sorted(allowed - {layer}) or 'なし'}）: {imp}", raw[line - 1]))
        for pat in forbidden:
            if re.search(pat, imp):
                out.append(Finding("arch.domain-purity", "P16", "error", r, line,
                                   f"ドメインが技術的関心事に依存: {imp}。変換は外側の層で行う", raw[line - 1]))
                break
    return out


# ---------------- 入口 ----------------
def lint_file(path, use_baseline=True) -> list[Finding]:
    cfg = config()
    r = rel(path)
    p = root() / r
    if not p.exists() or is_excluded(r, cfg) or is_test(r, cfg) or is_gate_exempt(r, cfg):
        return []
    src = p.read_text(encoding="utf-8", errors="ignore")
    if r.endswith(".sql"):
        found = lint_sql(r, src) if is_migration(r, cfg) else []
    else:
        lg = L.lang_of(r, cfg.get("languages") or None)
        if not lg:
            return []
        layer = layer_of(r, cfg)
        found = apply_rules(r, src, lg, layer, cfg) + check_arch(r, src, lg, layer, cfg)
    if "harness-allow" in src:
        found += invalid_allows(r, src)
    disabled = set(cfg["principles"].get("disabled") or [])
    found = [f for f in found if f.principle not in disabled]
    if use_baseline:
        bl = baseline()
        found = [f for f in found if f.fingerprint() not in bl]
    return found


def source_files():
    from .core import walk_files
    cfg = config()
    for p in walk_files():
        r = rel(p)
        if is_test(r, cfg):
            continue
        if r.endswith(".sql") or L.lang_of(r, cfg.get("languages") or None):
            yield p
