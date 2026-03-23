---
name: fix-specs
description: Normalize spec filenames in .ai/specs and .ai/specs/enterprise to the date+slug convention. Use this when legacy `SPEC-*` / `SPEC-ENT-*` names need to be cleaned up, when filename collisions appear after dropping numeric prefixes, or when links must be updated after normalization.
---

# Fix Specs

Normalize legacy spec filenames to the date+slug convention with minimal churn.

## When to use

- Legacy specs still use `SPEC-*` or `SPEC-ENT-*` filename prefixes.
- Two specs would collide after removing the numeric prefix.
- Links now point to the wrong filename after normalization.

## Rules

1. New canonical filenames are `{YYYY-MM-DD}-{slug}.md` for both OSS and enterprise specs.
2. Remove legacy `SPEC-*` / `SPEC-ENT-*` filename prefixes instead of inventing replacement numbers.
3. If two files would normalize to the same target, keep the older filename target and make the newer slug more specific.
4. Update filename references and links everywhere in the repo.
5. Preserve document history inside the file content when useful, but filenames MUST follow the date+slug format.

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
- Conflict resolution drops legacy numeric prefixes first, then adds a slug suffix only when two files would land on the same target filename.
- Files without an embedded `YYYY-MM-DD` segment are skipped by the script and must be normalized manually.
- Review in-file titles manually after normalization if you also want to remove legacy `SPEC-*` labels from headings.
