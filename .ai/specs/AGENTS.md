# Specs Folder — Agent Rules

Check `.ai/specs/` before modifying any module. Create or update specs when the change is non-trivial.

## Detailed Guidance

For detailed spec writing and review, use the spec-writing skill:
- `.ai/skills/spec-writing/SKILL.md`

## Create/Update Triggers

- Create a new spec for a new module, significant feature, or architecture change touching multiple files.
- Update an existing spec when changing APIs, data models, workflows, permissions, or cross-module behavior.
- Skip specs for small bug fixes, typo-only edits, and isolated one-file refactors with no behavior change.

## File Naming Convention

Use `SPEC-{number}-{date}-{title}.md`.
- `number`: sequential zero-padded ID (`001`, `002`, ...)
- `date`: `YYYY-MM-DD`
- `title`: kebab-case summary

Examples:
- `SPEC-023-2026-02-11-confirmation-dialog-migration.md`
- `SPEC-024-2026-02-12-example-module.md`

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
