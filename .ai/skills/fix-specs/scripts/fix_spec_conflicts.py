#!/usr/bin/env python3
import argparse
import os
import re
from dataclasses import dataclass
from pathlib import Path


TEXT_EXTENSIONS = {".md", ".mdx", ".txt"}
SKIP_DIRS = {".git", "node_modules", ".next", "dist", "build", ".turbo", "coverage"}
LEGACY_PATTERN = re.compile(r"^(SPEC(?:-ENT)?)-([0-9]+[A-Za-z0-9]*)-(.+)\.md$")
CANONICAL_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*\.md$")


@dataclass
class RenamePlan:
    source: Path
    target: Path


def find_specs_roots(repo_root: Path) -> list[Path]:
    candidates = [
        repo_root / ".ai/specs",
        repo_root / "ai/specs",
    ]
    roots: list[Path] = []
    seen: set[Path] = set()
    for candidate in candidates:
        if candidate.exists() and candidate.is_dir():
            resolved = candidate.resolve()
            if resolved in seen:
                continue
            seen.add(resolved)
            roots.append(candidate)
    return roots


def iter_markdown_files(root: Path) -> list[Path]:
    files: list[Path] = []
    for path in root.rglob("*.md"):
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if "analysis" in path.parts:
            continue
        files.append(path)
    return sorted(files)


def canonical_target_name(path: Path) -> str | None:
    if CANONICAL_PATTERN.match(path.name):
        return None

    legacy_match = LEGACY_PATTERN.match(path.name)
    if legacy_match:
        tail = legacy_match.group(3)
        if not re.match(r"^\d{4}-\d{2}-\d{2}-", tail):
            return None
        return tail + ".md"

    return None


def split_date_and_slug(file_name: str) -> tuple[str, str]:
    stem = file_name.removesuffix(".md")
    date_part, slug_part = stem[:10], stem[11:]
    return date_part, slug_part


def choose_available_target(source: Path, desired_name: str, reserved: set[Path]) -> Path:
    desired_target = source.with_name(desired_name)
    if desired_target == source or (not desired_target.exists() and desired_target not in reserved):
        return desired_target

    date_part, slug_part = split_date_and_slug(desired_name)
    suffix = 2
    while True:
        candidate = source.with_name(f"{date_part}-{slug_part}-{suffix}.md")
        if candidate == source or (not candidate.exists() and candidate not in reserved):
            return candidate
        suffix += 1


def build_rename_plan(repo_root: Path) -> list[RenamePlan]:
    reserved_targets: set[Path] = set()
    plans: list[RenamePlan] = []

    for root in find_specs_roots(repo_root):
        for path in iter_markdown_files(root):
            target_name = canonical_target_name(path)
            if target_name is None:
                continue

            target_path = choose_available_target(path, target_name, reserved_targets)
            reserved_targets.add(target_path)
            plans.append(RenamePlan(source=path, target=target_path))

    return plans


def replace_in_text_files(repo_root: Path, replacements: list[tuple[str, str]], dry_run: bool) -> int:
    changed = 0
    for root, dirs, files in os.walk(repo_root):
        dirs[:] = [directory for directory in dirs if directory not in SKIP_DIRS]
        root_path = Path(root)

        for file_name in files:
            path = root_path / file_name
            if path.suffix.lower() not in TEXT_EXTENSIONS:
                continue

            try:
                content = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue

            updated = content
            for old, new in replacements:
                updated = updated.replace(old, new)

            if updated == content:
                continue

            changed += 1
            if not dry_run:
                path.write_text(updated, encoding="utf-8")

    return changed


def apply_plan(repo_root: Path, plans: list[RenamePlan], dry_run: bool) -> int:
    if not plans:
        print("No legacy spec filenames found.")
        return 0

    replacements = [(plan.source.name, plan.target.name) for plan in plans]

    for plan in plans:
        if plan.source == plan.target:
            continue
        print(f"{plan.source} -> {plan.target}")

    updated_files = replace_in_text_files(repo_root, replacements, dry_run=dry_run)
    print(f"Updated filename references in {updated_files} text file(s)")

    if not dry_run:
        for plan in plans:
            if plan.source == plan.target:
                continue
            plan.source.rename(plan.target)

    return len(plans)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Normalize legacy spec filenames to the date+slug convention"
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="show planned changes")
    mode.add_argument("--apply", action="store_true", help="apply changes")
    parser.add_argument(
        "--root",
        type=Path,
        default=Path.cwd(),
        help="repository root (default: current directory)",
    )
    args = parser.parse_args()

    repo_root = args.root.resolve()
    dry_run = not args.apply

    plans = build_rename_plan(repo_root)
    rename_count = apply_plan(repo_root, plans, dry_run=dry_run)
    if rename_count > 0:
        print(f"{'Planned' if dry_run else 'Applied'} {rename_count} spec filename normalization(s).")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
