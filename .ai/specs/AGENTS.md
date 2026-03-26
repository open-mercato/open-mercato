# Specs Folder — Agent Rules

Check `.ai/specs/` and `.ai/specs/enterprise/` before modifying any module. Create or update specs when the change is non-trivial.

## Spec Separation

- `.ai/specs/` contains Open Source edition specifications.
- `.ai/specs/enterprise/` contains commercial Enterprise Edition specifications.
- New enterprise specs use the same `{date}-{title}.md` filename convention as OSS specs; the directory path, not a filename prefix, defines the scope.
- Enterprise specifications are not distributed under the open source license. For commercial licensing and partnership details, see [`packages/enterprise/README.md`](../../packages/enterprise/README.md).

## Spec Lifecycle States

Specs are organized by implementation status:
- **Root** (`.ai/specs/`): Pending, draft, in-progress, or partially implemented specs
- **Implemented** (`.ai/specs/implemented/`): Fully implemented and deployed specs
- **Enterprise Root** (`.ai/specs/enterprise/`): Pending enterprise specs
- **Enterprise Implemented** (`.ai/specs/enterprise/implemented/`): Fully implemented enterprise specs

Move a spec to `implemented/` when all phases are complete and the feature is deployed. Use `git mv` to preserve history. Update all cross-references when moving.

## Detailed Guidance

For detailed spec writing and review, use the spec-writing skill:
- `.ai/skills/spec-writing/SKILL.md`

## Create/Update Triggers

- Create a new spec for a new module, significant feature, or architecture change touching multiple files.
- Update an existing spec when changing APIs, data models, workflows, permissions, or cross-module behavior.
- Skip specs for small bug fixes, typo-only edits, and isolated one-file refactors with no behavior change.

## File Naming Convention

Use the naming format that matches scope:
- OSS: `{date}-{title}.md`
- Enterprise: `{date}-{title}.md`
- `date`: `YYYY-MM-DD`
- `title`: kebab-case summary
- Legacy numbered filenames may remain in the repo until they are intentionally normalized, but new specs MUST NOT introduce `SPEC-*` or `SPEC-ENT-*` filename prefixes.

Examples:
- `2026-02-11-confirmation-dialog-migration.md`
- `2026-02-12-example-module.md`
- `2026-02-17-security-module-enterprise-mfa.md`

## Workflow Triggers

### Before coding

- Find related spec(s), read current intent, and identify deltas.
- If no spec exists and triggers apply, create one before implementation.

### During coding

- Keep spec sections in sync with architecture and API/model decisions.
- Record scope changes and tradeoffs as they happen.

### After coding

- Update changelog with exact date and concise summary.
- Re-run review checklist and final compliance gate before approval.

## MUST Rules (Condensed)

- Every non-trivial spec includes: TLDR, Overview, Problem Statement, Proposed Solution, Architecture, Data Models, API Contracts, Risks & Impact Review, Final Compliance Report, Changelog.
- Risks must document concrete failure scenarios, severity, affected area, mitigation, and residual risk.
- Keep specs implementation-accurate: no stale endpoints, entities, or assumptions.
- Use Task Router from root `AGENTS.md` to identify all related guides for review.
