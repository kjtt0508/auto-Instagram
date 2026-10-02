"""スタック検出 → harness.yaml 生成"""
from __future__ import annotations

import json
import re
import shutil
from collections import Counter
from pathlib import Path

from . import lang as L
from .core import HARNESS_DIR, config, is_test, rel, root, walk_files, yaml


def _find(names: list[str], max_depth=3) -> list[Path]:
    R, out = root(), []
    for p in walk_files():
        if p.name in names or any(Path(p.name).match(n) for n in names if "*" in n):
            if len(p.relative_to(R).parts) <= max_depth + 1:
                out.append(p)
    return out


def _cwd(p: Path) -> str:
    return rel(p.parent) or "."


def detect() -> dict:
    """{languages, steps, internal_prefixes, layer_paths, notes}"""
    langs, steps, prefixes, paths, notes, aliases = set(), [], set(), {}, [], {}

    for pom in _find(["pom.xml"]):
        langs.add("java")
        mvn = "./mvnw" if (pom.parent / "mvnw").exists() else "mvn"
        steps.append({"name": f"maven verify ({_cwd(pom)})", "run": f"{mvn} -B verify", "cwd": _cwd(pom)})
    for g in _find(["build.gradle", "build.gradle.kts"]):
        if (g.parent.parent / "settings.gradle").exists() or (g.parent.parent / "settings.gradle.kts").exists():
            continue  # マルチプロジェクトのサブモジュール
        langs.add("java")
        gw = "./gradlew" if (g.parent / "gradlew").exists() else "gradle"
        steps.append({"name": f"gradle check ({_cwd(g)})", "run": f"{gw} check", "cwd": _cwd(g)})
    for pj in _find(["package.json"]):
        try:
            data = json.loads(pj.read_text(encoding="utf-8"))
        except Exception:
            continue
        langs.add("typescript")
        scripts = data.get("scripts", {})
        pm = "pnpm" if (pj.parent / "pnpm-lock.yaml").exists() else "yarn" if (pj.parent / "yarn.lock").exists() else "npm"
        cmds = [f"{pm} run {s}" for s in ("lint", "typecheck", "test", "build") if s in scripts]
        if cmds:
            steps.append({"name": f"{pm} ({_cwd(pj)})", "run": " && ".join(cmds), "cwd": _cwd(pj)})
        deps = {**data.get("dependencies", {}), **data.get("devDependencies", {})}
        base = _cwd(pj)
        pre = "" if base == "." else base + "/"
        if "next" in deps:
            paths.setdefault("presentation", []).extend([f"{pre}app/**", f"{pre}src/app/**", f"{pre}pages/**", f"{pre}src/pages/**",
                                                         f"{pre}src/components/**", f"{pre}components/**"])
            # API クライアント・hooks は画面から使う「アプリケーション層」。domain からは参照させない
            paths.setdefault("application", []).extend([f"{pre}src/lib/api/**", f"{pre}lib/api/**", f"{pre}src/hooks/**", f"{pre}src/usecases/**"])
            notes.append(f"Next.js を検出（{base}）: app/ pages/ components/ を presentation、lib/api・hooks を application に割当て")
        tsc = pj.parent / "tsconfig.json"
        if tsc.exists():
            try:
                txt = re.sub(r"//[^\n]*|/\*.*?\*/", "", tsc.read_text(encoding="utf-8"), flags=re.S)
                txt = re.sub(r",\s*([}\]])", r"\1", txt)
                copt = json.loads(txt).get("compilerOptions", {})
                base_url = copt.get("baseUrl", ".")
                for k, v in (copt.get("paths") or {}).items():
                    if k.endswith("/*") and v:
                        tgt = str(Path(base) / base_url / v[0].rstrip("*")).replace("\\", "/")
                        tgt = re.sub(r"^\./", "", re.sub(r"/\./", "/", tgt))
                        aliases[k[:-1]] = tgt.rstrip("/") + "/"
            except Exception:
                notes.append(f"{rel(tsc)} の paths を読めませんでした（architecture.aliases を手で設定）")
        if "@nestjs/core" in deps:
            notes.append(f"NestJS を検出（{base}）: *.controller.ts を presentation に割当て")
            paths.setdefault("presentation", []).append(f"{pre}**/*.controller.ts")
        prefixes.update(["@/", "~/"])
    for py in _find(["pyproject.toml", "setup.py", "requirements.txt"], max_depth=2):
        langs.add("python")
        txt = py.read_text(encoding="utf-8", errors="ignore")
        cmds = []
        if "ruff" in txt:
            cmds.append("ruff check .")
        if "mypy" in txt:
            cmds.append("mypy .")
        cmds.append("python -m pytest -q")
        steps.append({"name": f"python ({_cwd(py)})", "run": " && ".join(cmds), "cwd": _cwd(py)})
        for base in (py.parent, py.parent / "src"):
            for d in base.iterdir() if base.exists() else []:
                if d.is_dir() and (d / "__init__.py").exists() and d.name not in ("tests", "test"):
                    prefixes.add(d.name)
        if "django" in txt.lower():
            notes.append("Django を検出: models.py は ORM（infrastructure 扱い推奨）。ドメインは別パッケージ domain/ に置く")
    for gm in _find(["go.mod"]):
        langs.add("go")
        m = re.search(r"^module\s+(\S+)", gm.read_text(encoding="utf-8"), re.M)
        if m:
            prefixes.add(m.group(1))
        steps.append({"name": f"go ({_cwd(gm)})", "run": "go vet ./... && go test ./...", "cwd": _cwd(gm)})
    cs = _find(["*.sln"]) or _find(["*.csproj"])
    if cs:
        langs.add("csharp")
        steps.append({"name": "dotnet test", "run": "dotnet test", "cwd": _cwd(cs[0])})
    for cj in _find(["composer.json"]):
        langs.add("php")
        try:
            data = json.loads(cj.read_text(encoding="utf-8"))
        except Exception:
            data = {}
            notes.append(f"{rel(cj)} を解析できませんでした")
        for ns in (data.get("autoload", {}).get("psr-4", {}) or {}):
            prefixes.add(ns.rstrip("\\"))
        run = "composer test" if "test" in (data.get("scripts") or {}) else "vendor/bin/phpunit"
        steps.append({"name": f"php ({_cwd(cj)})", "run": run, "cwd": _cwd(cj)})
        if "laravel/framework" in json.dumps(data):
            notes.append("Laravel を検出: app/Models（Eloquent）は infrastructure 扱い。ドメインは app/Domain 等に")
            paths.setdefault("infrastructure", []).append(f"{'' if _cwd(cj) == '.' else _cwd(cj) + '/'}app/Models/**")
    for gf in _find(["Gemfile"]):
        langs.add("ruby")
        run = "bundle exec rspec" if (gf.parent / "spec").exists() else "bundle exec rake test"
        steps.append({"name": f"ruby ({_cwd(gf)})", "run": run, "cwd": _cwd(gf)})
        if (gf.parent / "config" / "application.rb").exists():
            notes.append("Rails を検出: app/models（ActiveRecord）は infrastructure 扱い。ドメインは app/domain に")
            paths.setdefault("infrastructure", []).append(f"{'' if _cwd(gf) == '.' else _cwd(gf) + '/'}app/models/**")

    # Java / Kotlin / C# / PHP の base package：レイヤ名より手前の共通接頭辞
    layer_names = {x.lower() for spec in config()["architecture"]["layers"].values() for x in spec.get("segments", [])}
    by_lang: dict[str, list[list[str]]] = {}
    for p in walk_files():
        if p.suffix in (".java", ".kt", ".cs", ".php"):
            m = re.search(r"^\s*(?:package|namespace)\s+([\w.\\]+)", p.read_text(encoding="utf-8", errors="ignore"), re.M)
            if m:
                sep = "\\" if p.suffix == ".php" else "."
                segs = m.group(1).split(sep)
                cut = next((i for i, x in enumerate(segs) if x.lower() in layer_names), len(segs))
                if 3 <= cut < len(segs):
                    cut -= 1  # base.<コンテキスト>.<レイヤ> のコンテキスト部分を外し、全コンテキストを内部扱いにする
                by_lang.setdefault(p.suffix, []).append(segs[:cut])
    for suf, lists in by_lang.items():
        common = lists[0]
        for l in lists[1:]:
            common = [a for a, b in zip(common, l) if a == b][: len(common)]
            i = 0
            while i < min(len(common), len(l)) and common[i] == l[i]:
                i += 1
            common = common[:i]
        if common:
            prefixes.add(("\\" if suf == ".php" else ".").join(common))
    if any(p.suffix == ".kt" for p in walk_files()):
        langs.add("kotlin")
    if aliases:
        prefixes -= {"@/", "~/"}
    return {"languages": sorted(langs), "steps": steps, "internal_prefixes": sorted(prefixes), "aliases": aliases,
            "layer_paths": {k: sorted(set(v)) for k, v in paths.items()}, "notes": notes}


def count_sources(cfg) -> int:
    n = 0
    for p in walk_files():
        r = rel(p)
        if L.lang_of(r) and not is_test(r, cfg):
            n += 1
    return n


def run(mode: str | None, force: bool) -> int:
    R = root()
    target = R / "harness.yaml"
    if target.exists() and not force:
        print("harness.yaml は既にあります（--force で再生成）")
        return 1
    det = detect()
    n = count_sources(config())
    legacy = mode == "legacy" or (mode is None and n > 0)
    conf = {"languages": det["languages"],
            "architecture": {"internal_prefixes": det["internal_prefixes"], **({"aliases": det["aliases"]} if det["aliases"] else {})},
            "verify": {"steps": det["steps"]}}
    if det["layer_paths"]:
        conf["architecture"]["layers"] = {k: {"paths": v} for k, v in det["layer_paths"].items()}
    if legacy:
        conf["enforcement"] = {"phase_gate": "warn", "model_first": "warn", "stop_check": "warn"}
    header = ("# harness.yaml — このプロジェクト固有の設定（.claude/harness/defaults.yaml を上書き）\n"
              "# 生成: harness init。レイヤ判定・verify 手順・強制レベルをここで調整する。\n")
    target.write_text(header + yaml.safe_dump(conf, allow_unicode=True, sort_keys=False), encoding="utf-8")

    cfg_docs = yaml.safe_load((HARNESS_DIR / "defaults.yaml").read_text(encoding="utf-8"))["docs"]
    for d in cfg_docs.values():
        dd = R / (Path(d).parent if d.endswith(".yaml") else d)
        dd.mkdir(parents=True, exist_ok=True)
    pr = R / "docs" / "principles.md"
    if not pr.exists():
        shutil.copy(HARNESS_DIR / "templates" / "principles.md", pr)
    gi = R / ".gitignore"
    if ".harness/" not in (gi.read_text(encoding="utf-8") if gi.exists() else ""):
        with gi.open("a", encoding="utf-8") as f:
            f.write("\n# harness\n.harness/\n")

    print(f"harness.yaml を生成しました（言語: {', '.join(det['languages']) or '未検出'} / 既存ソース {n} ファイル）")
    for s in det["steps"]:
        print(f"  verify: [{s['cwd']}] {s['run']}")
    print(f"  internal_prefixes: {det['internal_prefixes']}")
    if det["aliases"]:
        print(f"  aliases: {det['aliases']}")
    for note in det["notes"]:
        print("  - " + note)
    if legacy:
        print("\n既存コードがあるため『段階導入モード』にしました（工程ゲート・モデル先行は警告のみ）。次の順で進めてください:\n"
              "  1. harness baseline        … 既存の違反を記録し、新規の違反だけを検出対象にする\n"
              "  2. harness scaffold-model  … 既存 domain の型を用語集に下書き登録（todo）\n"
              "  3. 用語集を埋め終えたら harness.yaml の enforcement を deny に上げる")
    print("\n構造テストの追加アダプタ: .claude/harness/adapters/README.md")
    return 0
