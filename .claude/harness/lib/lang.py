"""言語仕様：コメント/文字列の除去、import・型宣言・関数の抽出"""
from __future__ import annotations

import re
from pathlib import Path

C = dict(line=["//"], block=[("/*", "*/")])
LANGS: dict[str, dict] = {
    "java": dict(exts=[".java"], **C, quotes=['"""', '"', "'"],
                 imports=[r"^\s*import\s+(?:static\s+)?([\w.]+)"],
                 types=r"\b(?:class|interface|enum|record)\s+([A-Z]\w*)",
                 func=r"^\s*(?:[\w<>\[\],.?@]+\s+)+(\w+)\s*\([^;]*$",
                 block_style="brace",
                 primitives=["String", "int", "long", "double", "float", "Integer", "Long", "Double", "BigDecimal", "boolean", "Boolean"]),
    "kotlin": dict(exts=[".kt", ".kts"], **C, quotes=['"""', '"', "'"],
                   imports=[r"^\s*import\s+([\w.]+)"],
                   types=r"\b(?:class|interface|object)\s+([A-Z]\w*)",
                   func=r"\bfun\s+(?:<[^>]+>\s*)?(?:[\w.]+\.)?(\w+)\s*\(",
                   block_style="brace",
                   primitives=["String", "Int", "Long", "Double", "Float", "BigDecimal", "Boolean"]),
    "typescript": dict(exts=[".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte"], **C, quotes=['"', "'", "`"],
                       imports=[r"""(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]""",
                                r"""^\s*import\s*['"]([^'"]+)['"]""",
                                r"""(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)"""],
                       types=r"\b(?:class|interface|type|enum)\s+([A-Z]\w*)",
                       func=r"(?:\bfunction\s*\*?\s*(\w+)\s*\(|^\s*(?:(?:public|private|protected|static|async|readonly|override)\s+)*(\w+)\s*\([^)]*\)\s*(?::\s*[^={;]+)?\{\s*$|\b(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*(?::\s*[^=]+)?=>\s*\{\s*$)",
                       block_style="brace",
                       primitives=["string", "number", "boolean", "bigint", "any"]),
    "python": dict(exts=[".py"], line=["#"], block=[], quotes=['"""', "'''", '"', "'"],
                   imports=[r"^\s*from\s+([.\w]+)\s+import\b", r"^\s*import\s+([\w.]+)"],
                   types=r"^\s*class\s+([A-Z]\w*)",
                   func=r"^\s*(?:async\s+)?def\s+(\w+)\s*\(",
                   block_style="indent",
                   primitives=["str", "int", "float", "Decimal", "bool", "dict", "Dict"]),
    "go": dict(exts=[".go"], **C, quotes=['"', "`", "'"],
               imports=[],  # go_imports() で処理
               types=r"^\s*type\s+([A-Z]\w*)\s",
               func=r"^func\s+(?:\([^)]*\)\s*)?(\w+)\s*\(",
               block_style="brace",
               primitives=["string", "int", "int64", "int32", "float64", "bool"]),
    "csharp": dict(exts=[".cs"], **C, quotes=['"', "'"],
                   imports=[r"^\s*(?:global\s+)?using\s+(?:static\s+)?([\w.]+)\s*;"],
                   types=r"\b(?:class|interface|enum|record|struct)\s+([A-Z]\w*)",
                   func=r"^\s*(?:(?:public|private|protected|internal|static|virtual|override|async|sealed|abstract|partial|new)\s+)+[\w<>\[\],.?()]+\s+(\w+)\s*\([^;]*$",
                   block_style="brace",
                   primitives=["string", "int", "long", "double", "decimal", "bool", "float", "String"]),
    "php": dict(exts=[".php"], line=["//", "#"], block=[("/*", "*/")], quotes=['"', "'"], line_exclude={"#": "["},
                imports=[r"^\s*use\s+([\w\\]+)"],
                types=r"\b(?:class|interface|enum|trait)\s+([A-Z]\w*)",
                func=r"\bfunction\s+(\w+)\s*\(",
                block_style="brace",
                primitives=["string", "int", "float", "bool", "array"]),
    "ruby": dict(exts=[".rb"], line=["#"], block=[("=begin", "=end")], quotes=['"', "'"],
                 imports=[r"""^\s*require(?:_relative)?\s*\(?\s*['"]([^'"]+)['"]"""],
                 types=r"^\s*(?:class|module)\s+([A-Z]\w*)",
                 func=r"^\s*def\s+(?:self\.)?([\w?!=]+)",
                 block_style="end",
                 primitives=[]),
}
CONTROL = {"if", "for", "while", "switch", "catch", "when", "foreach", "using", "lock", "else", "do", "try",
           "return", "new", "synchronized", "fixed", "match", "elif", "with", "super", "this", "throw"}


def lang_of(path: str, enabled: list[str] | None = None) -> str | None:
    ext = Path(path).suffix.lower()
    for name, spec in LANGS.items():
        if ext in spec["exts"] and (not enabled or name in enabled or (name == "kotlin" and "java" in enabled)):
            return name
    return None


def _blank(s: str) -> str:
    return re.sub(r"[^\n]", " ", s)


def scan(src: str, lang: str, keep_strings: bool = False) -> str:
    """コメントを空白化し、（既定で）文字列の中身も空白化する。行数・桁位置は保持"""
    spec = LANGS[lang]
    out, i, n = [], 0, len(src)
    excl = spec.get("line_exclude", {})
    while i < n:
        hit = False
        for a, b in spec["block"]:
            if src.startswith(a, i):
                j = src.find(b, i + len(a))
                j = n if j < 0 else j + len(b)
                out.append(_blank(src[i:j])); i = j; hit = True
                break
        if hit:
            continue
        for a in spec["line"]:
            if src.startswith(a, i) and not (a in excl and src.startswith(a + excl[a], i)):
                j = src.find("\n", i)
                j = n if j < 0 else j
                out.append(" " * (j - i)); i = j; hit = True
                break
        if hit:
            continue
        for q in spec["quotes"]:
            if src.startswith(q, i):
                j, closed = i + len(q), False
                while j < n:
                    if src[j] == "\\":
                        j += 2
                        continue
                    if src.startswith(q, j):
                        j += len(q); closed = True
                        break
                    if len(q) == 1 and q != "`" and src[j] == "\n":
                        break
                    j += 1
                seg = src[i:j]
                if keep_strings:
                    out.append(seg)
                else:
                    inner = seg[len(q): len(seg) - (len(q) if closed else 0)]
                    out.append(q + _blank(inner) + (q if closed else ""))
                i = j; hit = True
                break
        if hit:
            continue
        out.append(src[i]); i += 1
    return "".join(out)


def depths(code: str) -> list[tuple[int, str]]:
    """各行の開始時ブレース深さと、そのトップレベルブロックを開いた宣言行"""
    res, d, opener, last = [], 0, "", ""
    for line in code.split("\n"):
        res.append((d, opener))
        if d == 0 and line.strip() and not line.strip().startswith(("{", "@", "[", "#[")):
            last = line
        for ch in line:
            if ch == "{":
                if d == 0:
                    opener = last or line
                d += 1
            elif ch == "}":
                d = max(0, d - 1)
    return res


def imports(src: str, lang: str) -> list[tuple[int, str, bool]]:
    """(行番号, import 文字列, 相対か)"""
    code = scan(src, lang, keep_strings=True)
    out = []
    if lang == "go":
        in_block = False
        for i, l in enumerate(code.split("\n"), 1):
            s = l.strip()
            if s.startswith("import ("):
                in_block = True
                continue
            if in_block and s == ")":
                in_block = False
                continue
            m = re.match(r'^(?:import\s+)?(?:[\w.]+\s+)?"([^"]+)"$', s)
            if m and (in_block or s.startswith("import")):
                out.append((i, m.group(1), False))
        return out
    for i, l in enumerate(code.split("\n"), 1):
        for pat in LANGS[lang]["imports"]:
            for m in re.finditer(pat, l):
                imp = next((g for g in m.groups() if g), None)
                if imp:
                    relative = imp.startswith(".") or (lang == "ruby" and "require_relative" in l)
                    out.append((i, imp, relative))
    return out


def type_names(src: str, lang: str, top_level_only: bool = False) -> list[str]:
    """型宣言の名前。top_level_only=True なら入れ子の型（private な補助クラス等）を除く"""
    code = scan(src, lang)
    if not top_level_only or lang == "ruby":
        return list(dict.fromkeys(re.findall(LANGS[lang]["types"], code, flags=re.M)))
    out, lines = [], code.split("\n")
    dep = depths(code) if LANGS[lang]["block_style"] == "brace" else None
    for i, l in enumerate(lines):
        for m in re.finditer(LANGS[lang]["types"], l):
            if dep is not None:
                d, opener = dep[i]
                top = d == 0 or (d == 1 and re.search(r"\bnamespace\b", opener))
            else:
                top = not l[:1].isspace()
            if top:
                out.append(m.group(1))
    return list(dict.fromkeys(out))


def functions(code: str, lang: str) -> list[tuple[int, str, int]]:
    """(開始行, 名前, 行数)"""
    spec, lines, out = LANGS[lang], code.split("\n"), []
    for i, l in enumerate(lines):
        m = re.search(spec["func"], l)
        if not m:
            continue
        name = next((g for g in m.groups() if g), "")
        if name in CONTROL or not name:
            continue
        if spec["block_style"] == "brace":
            end = _brace_end(lines, i)
        else:
            end = _indent_end(lines, i, spec["block_style"] == "end")
        if end is not None:
            out.append((i + 1, name, end - i + 1))
    return out


def _brace_end(lines, i):
    d, started = 0, False
    for j in range(i, min(len(lines), i + 400)):
        for ch in lines[j]:
            if ch == ";" and not started and j <= i + 2:
                return None if "{" not in lines[j] else None
            if ch == "{":
                d += 1; started = True
            elif ch == "}":
                d -= 1
                if started and d == 0:
                    return j
        if not started and j > i + 2:
            return None
    return None


def _indent_end(lines, i, ruby):
    ind = len(lines[i]) - len(lines[i].lstrip())
    last = i
    for j in range(i + 1, len(lines)):
        s = lines[j]
        if not s.strip():
            continue
        k = len(s) - len(s.lstrip())
        if ruby and k == ind and s.strip() == "end":
            return j
        if k <= ind:
            return None if ruby else last
        last = j
    return last


def enclosing_func(code_lines: list[str], idx: int, lang: str) -> str | None:
    """インデント言語で、行 idx を含む関数名"""
    cur = code_lines[idx]
    ind = len(cur) - len(cur.lstrip())
    for j in range(idx - 1, -1, -1):
        l = code_lines[j]
        if not l.strip():
            continue
        k = len(l) - len(l.lstrip())
        if k < ind:
            m = re.search(LANGS[lang]["func"], l)
            if m:
                return next((g for g in m.groups() if g), None)
            ind = k
    return None
