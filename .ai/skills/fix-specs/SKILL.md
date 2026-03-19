---
name: fix-specs
description: Detect and fix spec number conflicts in .ai/specs and .ai/specs/enterprise (including ai/specs and ai/specs/enterpirse path variants). Use this when duplicate SPEC or SPEC-ENT numbers exist, when a new conflicting spec should be moved to the end, or when links/references must be updated after renumbering.
---

# Fix Specs

Resolve duplicate spec numbers with minimal renumbering.

## When to use

- A new spec was created with a number that already exists.
- Enterprise specs contain duplicate `SPEC-ENT-XXX` identifiers.
- Links now point to the wrong spec after a numbering conflict.

## Rules

1. Keep all existing spec numbers unchanged except the newest conflicting file.
2. Move only the newest conflicting spec to the end of the numeric sequence.
3. Update references and links to the moved spec.
4. Apply the same logic to both OSS specs and enterprise specs.
5. Preserve staged specs (`SPEC-041a`, `SPEC-041b`, ...): staged suffix variants are intentional and MUST NOT be treated as conflicts with the base number (`SPEC-041`) or other staged variants.
6. Only treat exact ID collisions as conflicts (`SPEC-041` vs `SPEC-041`, or `SPEC-041a` vs `SPEC-041a`).

## Workflow

1. Run a dry run first:
   `python3 .ai/skills/fix-specs/scripts/fix_spec_conflicts.py --dry-run`
2. Review planned renames and file updates.
3. Apply changes:
   `python3 .ai/skills/fix-specs/scripts/fix_spec_conflicts.py --apply`
4. Verify no conflicts remain:
   `python3 .ai/skills/fix-specs/scripts/fix_spec_conflicts.py --dry-run`

## Notes

- The script scans both `.ai/specs` and `ai/specs` roots if present.
- Enterprise typos are tolerated (`enterprise` and `enterpirse`).
- Conflict resolution prefers the embedded `YYYY-MM-DD` date in the filename, then falls back to file modification time.
- Staged chains (for example `SPEC-041a` through `SPEC-041m`) are preserved as-is unless the exact staged token is duplicated.
