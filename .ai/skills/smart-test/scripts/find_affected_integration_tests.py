#!/usr/bin/env python3
"""
find_affected_integration_tests.py

Maps changed files (from git diff or stdin) to affected Playwright integration test spec files
by reading module-level dependency declarations in __integration__/meta.ts files.

Usage:
  # Pipe git diff output
  git diff --name-only origin/develop...HEAD | python3 find_affected_integration_tests.py --project-root . --layer api-logic

  # Let the script call git diff internally, including local and untracked files
  python3 find_affected_integration_tests.py --project-root . --base origin/develop --layer ui-component

  # Explicit base and head
  python3 find_affected_integration_tests.py --project-root . --base origin/develop --head HEAD --layer data

Output:
  One relative spec file path per line, e.g.:
    packages/core/src/modules/customers/__integration__/customers.spec.ts

  Outputs "--all" (single line) when a wide-scope change is detected
  (shared utilities, build config, etc.) — caller should run the full suite.

  Outputs nothing when no integration tests are affected.
"""

import argparse
import re
import subprocess
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

WIDE_SCOPE_PREFIXES = (
    "packages/shared/",
    "packages/events/",
    "packages/queue/",
    "packages/cache/",
    "jest.config.",
    "jest.setup.",
    "tsconfig",
    "package.json",
    "turbo.json",
)

IGNORED_DIRS = frozenset({
    "node_modules", ".git", ".next", "dist", ".turbo",
    "coverage", "test-results", ".yarn", ".cache", "tmp", "temp",
    ".claude", ".codex",
})

META_FILE_NAMES = ("meta.ts", "index.ts")
DEPENDENCY_KEYS = ("dependsOnModules", "requiredModules", "requiresModules")


def run_git_names(args: list[str]) -> list[str]:
    result = subprocess.run(
        ["git", *args],
        capture_output=True,
        text=True,
        check=False,
    )
    return [line for line in result.stdout.strip().split("\n") if line]


def unique_paths(paths: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for path in paths:
        normalized = path.strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        result.append(normalized)
    return result

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def get_changed_files(base_ref: str | None, head_ref: str | None) -> list[str]:
    """Return changed file paths from git or stdin."""
    if not sys.stdin.isatty():
        stdin_paths = unique_paths([line.strip() for line in sys.stdin if line.strip()])
        if stdin_paths:
            return stdin_paths

    paths: list[str] = []
    has_explicit_base = bool(base_ref or head_ref)
    if base_ref and head_ref:
        paths.extend(run_git_names(["diff", "--name-only", f"{base_ref}...{head_ref}"]))
    elif base_ref:
        paths.extend(run_git_names(["diff", "--name-only", f"{base_ref}...HEAD"]))
    else:
        paths.extend(run_git_names(["diff", "--name-only", "HEAD"]))

    if has_explicit_base:
        paths.extend(run_git_names(["diff", "--name-only", "HEAD"]))
    paths.extend(run_git_names(["ls-files", "--others", "--exclude-standard"]))

    return unique_paths(paths)


def extract_module_identity_from_path(file_path: str) -> tuple[str, str] | None:
    """
    Extract a workspace-aware module identity from a path.

    The same module name can exist in multiple runtime roots, e.g.
    apps/mercato/src/modules/example and packages/create-app/template/src/modules/example.
    """
    parts = Path(file_path).parts
    for index, part in enumerate(parts):
        if part != "modules" or index + 1 >= len(parts):
            continue

        module_name = parts[index + 1].lower()
        prefix = parts[:index]

        if len(prefix) >= 3 and prefix[:3] == ("apps", "mercato", "src"):
            return module_name, "apps/mercato"

        if len(prefix) >= 4 and prefix[:4] == ("packages", "create-app", "template", "src"):
            return module_name, "packages/create-app/template"

        if len(prefix) >= 3 and prefix[0] == "packages" and prefix[2] == "src":
            return module_name, f"packages/{prefix[1]}"

        return module_name, "/".join(prefix)

    return None


def extract_module_name_from_path(file_path: str) -> str | None:
    """
    Extract the module name from a path containing /modules/<name>/.

    Examples:
      packages/core/src/modules/customers/lib/foo.ts  → "customers"
      apps/mercato/src/modules/pos/page.tsx            → "pos"
    """
    identity = extract_module_identity_from_path(file_path)
    return identity[0] if identity else None


def is_wide_scope(file_path: str) -> bool:
    return any(file_path.startswith(prefix) for prefix in WIDE_SCOPE_PREFIXES)


def extract_dependencies_from_source(source: str) -> set[str]:
    deps: set[str] = set()
    for key in DEPENDENCY_KEYS:
        match = re.search(rf"{key}\s*:\s*\[([\s\S]*?)\]", source)
        if not match:
            continue
        for value in re.findall(r"""['"`]([a-zA-Z0-9_.-]+)['"`]""", match.group(1)):
            cleaned = value.strip().lower()
            if cleaned:
                deps.add(cleaned)
    return deps


def read_dependencies_from_file(path: Path) -> set[str]:
    try:
        return extract_dependencies_from_source(path.read_text(encoding="utf-8"))
    except OSError:
        return set()


def is_ignored(path_part: str) -> bool:
    return path_part in IGNORED_DIRS


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------

def collect_integration_directories(root: Path) -> list[Path]:
    """Recursively find all __integration__ directories under root."""
    result: list[Path] = []

    def _walk(directory: Path) -> None:
        try:
            entries = list(directory.iterdir())
        except PermissionError:
            return
        for entry in entries:
            if not entry.is_dir():
                continue
            if is_ignored(entry.name):
                continue
            if entry.name == "__integration__":
                result.append(entry)
            else:
                _walk(entry)

    _walk(root)
    return result


def collect_spec_files(directory: Path) -> list[Path]:
    return list(directory.rglob("*.spec.ts"))


def resolve_module_name_for_integration_dir(integration_dir: Path) -> str | None:
    """The module name is the parent directory of __integration__."""
    return integration_dir.parent.name or None


def resolve_module_scope_for_integration_dir(project_root: Path, integration_dir: Path) -> str:
    try:
        rel = integration_dir.relative_to(project_root)
    except ValueError:
        rel = integration_dir

    identity = extract_module_identity_from_path(str(rel))
    return identity[1] if identity else ""


def build_integration_index(project_root: Path) -> list[dict]:
    """
    Returns a list of dicts, one per integration directory:
      {
        "module": str | None,
        "scope": str,
        "deps": set[str],          # declared dependsOnModules etc.
        "specs": list[Path],       # absolute spec file paths
      }
    """
    entries = []
    for integration_dir in collect_integration_directories(project_root):
        if any(is_ignored(part) for part in integration_dir.parts):
            continue

        module_name = resolve_module_name_for_integration_dir(integration_dir)
        module_scope = resolve_module_scope_for_integration_dir(project_root, integration_dir)
        deps: set[str] = set()

        for meta_name in META_FILE_NAMES:
            meta_path = integration_dir / meta_name
            if meta_path.exists():
                deps.update(read_dependencies_from_file(meta_path))

        # The module itself is always in its own dep set (self-coverage)
        if module_name:
            deps.add(module_name.lower())

        specs = collect_spec_files(integration_dir)

        entries.append({"module": module_name, "scope": module_scope, "deps": deps, "specs": specs})

    return entries


# ---------------------------------------------------------------------------
# Main logic
# ---------------------------------------------------------------------------

def find_affected_specs(project_root: Path, changed_files: list[str], layer: str = "mixed") -> list[str] | str:
    """
    Returns either:
      - "--all"  (string) when a wide-scope change is detected
      - list of relative spec file paths (may be empty)

    layer controls dependency-based triggering:
      - "ui" or "ui-component": only tests whose OWN module changed are included;
        dep_hit is ignored because a UI-only change cannot break another module's API calls.
      - "api-logic", "data", "mixed" (default): dep_hit is respected — any module
        that declares the changed module as a dependency will also run.
    """
    # Wide-scope check
    for f in changed_files:
        if is_wide_scope(f):
            return "--all"

    # Collect changed module names and workspace-aware module identities.
    changed_modules: set[str] = set()
    changed_module_identities: set[tuple[str, str]] = set()
    for f in changed_files:
        identity = extract_module_identity_from_path(f)
        if identity:
            module, scope = identity
            changed_modules.add(module)
            changed_module_identities.add((module, scope))

    # When no module-scoped changes (e.g., only root package lib files), check by
    # changed packages. Do not mark module-scoped package files as package-wide.
    changed_packages: set[str] = set()
    for f in changed_files:
        if extract_module_identity_from_path(f):
            continue
        parts = Path(f).parts
        if len(parts) >= 2 and parts[0] == "packages":
            changed_packages.add(parts[1])

    if not changed_modules and not changed_packages:
        return []

    # For UI-layer changes, dependency-based triggering is suppressed.
    # A changed page.tsx or component cannot break another module's API calls —
    # only the tests that directly visit those pages need to run.
    dep_hit_enabled = layer not in ("ui", "ui-component")

    integration_index = build_integration_index(project_root)

    affected_specs: set[str] = set()
    for entry in integration_index:
        # A test is affected if:
        # 1. Its own module is in changed_modules, OR
        # 2. (dep_hit_enabled) any of its declared dependencies is in changed_modules, OR
        # 3. Its parent package is in changed_packages
        entry_module = (entry["module"] or "").lower()
        entry_scope = entry["scope"]
        entry_deps = entry["deps"]

        module_hit = (entry_module, entry_scope) in changed_module_identities
        dep_hit = dep_hit_enabled and bool(entry_deps & changed_modules)
        if entry_scope == "packages/create-app/template":
            dep_hit = dep_hit and any(
                scope == "packages/create-app/template" for _module, scope in changed_module_identities
            )

        # Package hit: check if any spec lives in a changed package
        package_hit = False
        for spec in entry["specs"]:
            try:
                rel = spec.relative_to(project_root)
                rel_parts = rel.parts
                if len(rel_parts) >= 2 and rel_parts[0] == "packages" and rel_parts[1] in changed_packages:
                    package_hit = True
                    break
            except ValueError:
                pass

        if not (module_hit or dep_hit or package_hit):
            continue

        for spec in entry["specs"]:
            try:
                rel = spec.relative_to(project_root)
                rel_str = str(rel)
            except ValueError:
                rel_str = str(spec)

            affected_specs.add(rel_str)

    return sorted(affected_specs)


def main() -> None:
    parser = argparse.ArgumentParser(description="Find Playwright integration tests affected by changed files.")
    parser.add_argument("--project-root", default=".", help="Absolute or relative path to the monorepo root")
    parser.add_argument("--base", default=None, help="Base git ref (e.g. origin/develop)")
    parser.add_argument("--head", default=None, help="Head git ref (default: HEAD)")
    parser.add_argument(
        "--layer",
        default="mixed",
        choices=["ui", "ui-component", "api-logic", "data", "mixed"],
        help=(
            "Layer of changed files. ui/ui-component suppresses dependency-based "
            "triggering so only tests for directly changed modules run."
        ),
    )
    args = parser.parse_args()

    project_root = Path(args.project_root).resolve()
    changed_files = get_changed_files(args.base, args.head)

    if not changed_files:
        # Nothing changed
        sys.exit(0)

    result = find_affected_specs(project_root, changed_files, layer=args.layer)

    if result == "--all":
        print("--all")
    elif isinstance(result, list):
        for spec in result:
            print(spec)


if __name__ == "__main__":
    main()
