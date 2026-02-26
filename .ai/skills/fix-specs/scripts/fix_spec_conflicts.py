#!/usr/bin/env python3
import argparse
import os
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Iterable


OSS_PREFIX = "SPEC"
ENT_PREFIX = "SPEC-ENT"
TEXT_EXTENSIONS = {".md", ".mdx", ".txt"}
SKIP_DIRS = {".git", "node_modules", ".next", "dist", "build", ".turbo", "coverage"}


@dataclass
class SpecFile:
    path: Path
    prefix: str
    token: str
    tail: str
    mtime: float

    @property
    def base_name(self) -> str:
        return self.path.name

    @property
    def spec_id(self) -> str:
        return f"{self.prefix}-{self.token}"

    @property
    def dated_key(self) -> date | None:
        match = re.match(r"^(\d{4})-(\d{2})-(\d{2})-", self.tail)
        if not match:
            return None
        year, month, day = (int(value) for value in match.groups())
        try:
            return date(year, month, day)
        except ValueError:
            return None


def find_specs_root(repo_root: Path) -> list[Path]:
    candidates = [repo_root / ".ai/specs", repo_root / "ai/specs"]
    return [p for p in candidates if p.exists() and p.is_dir()]


def iter_spec_files(specs_root: Path) -> Iterable[SpecFile]:
    name_pattern = re.compile(
        r"^(SPEC(?:-ENT)?)-([0-9]+[A-Za-z0-9]*)-(.+)\.md$"
    )

    for path in specs_root.rglob("*.md"):
        if path.parent.name == "analysis":
            continue
        match = name_pattern.match(path.name)
        if not match:
            continue
        prefix, token, tail = match.groups()
        yield SpecFile(
            path=path,
            prefix=prefix,
            token=token,
            tail=tail,
            mtime=path.stat().st_mtime,
        )


def next_numeric_token(specs: list[SpecFile], min_width: int) -> str:
    max_number = 0
    for spec in specs:
        if spec.token.isdigit():
            max_number = max(max_number, int(spec.token))

    next_number = max_number + 1
    width = max(min_width, len(str(next_number)))
    return str(next_number).zfill(width)


def replace_in_text_files(
    repo_root: Path,
    old_base_name: str,
    new_base_name: str,
    dry_run: bool,
) -> int:
    changed = 0
    for root, dirs, files in os.walk(repo_root):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        root_path = Path(root)
        for file_name in files:
            path = root_path / file_name
            if path.suffix.lower() not in TEXT_EXTENSIONS:
                continue
            try:
                content = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            updated = content.replace(old_base_name, new_base_name)
            if updated == content:
                continue
            changed += 1
            if not dry_run:
                path.write_text(updated, encoding="utf-8")
    return changed


def replace_in_file(path: Path, old: str, new: str, dry_run: bool) -> bool:
    content = path.read_text(encoding="utf-8")
    updated = content.replace(old, new)
    if updated == content:
        return False
    if not dry_run:
        path.write_text(updated, encoding="utf-8")
    return True


def resolve_conflicts_for_prefix(
    repo_root: Path,
    specs: list[SpecFile],
    prefix: str,
    dry_run: bool,
) -> int:
    scoped = [s for s in specs if s.prefix == prefix]
    groups: dict[str, list[SpecFile]] = {}
    for spec in scoped:
        groups.setdefault(spec.token, []).append(spec)

    width = max((len(s.token) for s in scoped if s.token.isdigit()), default=3)
    conflict_count = 0

    for token, dupes in sorted(groups.items()):
        if len(dupes) < 2:
            continue

        conflict_count += 1
        newest = max(
            dupes,
            key=lambda item: (
                item.dated_key is not None,
                item.dated_key or date.min,
                item.mtime,
            ),
        )
        new_token = next_numeric_token(scoped, width)
        new_file_name = f"{newest.prefix}-{new_token}-{newest.tail}.md"
        new_path = newest.path.with_name(new_file_name)

        print(f"Conflict {prefix}-{token}: move newest {newest.base_name} -> {new_file_name}")

        ref_updates = replace_in_text_files(
            repo_root=repo_root,
            old_base_name=newest.base_name,
            new_base_name=new_file_name,
            dry_run=dry_run,
        )
        print(f"  Updated filename references in {ref_updates} text file(s)")

        old_spec_id = newest.spec_id
        new_spec_id = f"{newest.prefix}-{new_token}"
        id_updated = replace_in_file(newest.path, old_spec_id, new_spec_id, dry_run)
        if id_updated:
            print(f"  Updated in-file spec id {old_spec_id} -> {new_spec_id}")

        if not dry_run:
            newest.path.rename(new_path)

        newest.token = new_token
        newest.path = new_path

    return conflict_count


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Fix conflicting SPEC numbers with minimal renumbering"
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

    dry_run = not args.apply
    repo_root = args.root.resolve()

    specs_roots = find_specs_root(repo_root)
    if not specs_roots:
        print("No specs roots found (.ai/specs or ai/specs).")
        return 1

    total_conflicts = 0
    for specs_root in specs_roots:
        specs = list(iter_spec_files(specs_root))
        if not specs:
            print(f"No specs found in {specs_root}")
            continue

        print(f"Scanning {specs_root}")
        total_conflicts += resolve_conflicts_for_prefix(
            repo_root=repo_root,
            specs=specs,
            prefix=OSS_PREFIX,
            dry_run=dry_run,
        )
        total_conflicts += resolve_conflicts_for_prefix(
            repo_root=repo_root,
            specs=specs,
            prefix=ENT_PREFIX,
            dry_run=dry_run,
        )

    if total_conflicts == 0:
        print("No spec number conflicts found.")
    else:
        print(
            f"Resolved {total_conflicts} conflict(s) in {'dry-run' if dry_run else 'apply'} mode."
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
