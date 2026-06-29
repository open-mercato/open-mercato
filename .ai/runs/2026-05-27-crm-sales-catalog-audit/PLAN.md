# Plan — CRM / Sales / Catalog cross-module audit

**Date:** 2026-05-27
**Run id:** 2026-05-27-crm-sales-catalog-audit
**Brief:** Analyze the CRM (`customers`), `sales`, and `catalog` modules for inter-module references, security holes, race conditions, and DRY violations. File one GitHub issue per actionable finding and fix the highest-priority finding in this PR.
**Base branch:** `develop`
**Working branch:** `task/4476d81e-7df9-4d2e-8173-bd7b60e9808b` (janitor-managed worktree — do not rename).

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `auto-continue-pr`. Step ids are immutable once a Step has a commit.

| Phase | Step | Title                                                                   | Status | Commit  |
|-------|------|-------------------------------------------------------------------------|--------|---------|
| 0     | 0.1  | Seed run folder (PLAN, HANDOFF, NOTIFY)                                 | done   | fa281544|
| 1     | 1.1  | Audit `customers` (security / races / DRY / cross-module refs)          | done   | 4f4c7dcd|
| 1     | 1.2  | Audit `sales` (security / races / DRY / cross-module refs)              | done   | 4f4c7dcd|
| 1     | 1.3  | Audit `catalog` (security / races / DRY / cross-module refs)            | done   | 4f4c7dcd|
| 1     | 1.4  | Cross-module reference & DRY sweep (imports, links, response shapes)    | done   | 4f4c7dcd|
| 2     | 2.1  | Synthesize findings, score by severity × blast radius, write report     | done   | 4f4c7dcd|
| 3     | 3.1  | Open one GitHub issue per actionable finding (security, bug, refactor)  | done   | 4f4c7dcd|
| 4     | 4.1  | Implement fix for top-priority finding (smallest safe change)           | done   | 4f4c7dcd|
| 4     | 4.2  | Add focused unit tests covering the fix                                 | done   | 4f4c7dcd|
| 5     | 5.1  | Run targeted validation (typecheck + tests for the touched package)     | done   | 4f4c7dcd|
| 6     | 6.1  | Final gate + open PR against `develop`                                  | todo   | —       |

## Goal

Surface real correctness and security risks across the three reference business modules (CRM/customers, sales, catalog), file them as discrete GitHub issues so the team can schedule them independently, and land a tight fix for the single highest-priority finding in this PR.

## Scope

- `packages/core/src/modules/customers/**`
- `packages/core/src/modules/sales/**`
- `packages/core/src/modules/catalog/**`
- Their data links / extensions referencing the other two modules.
- Read-only review of common helpers under `packages/shared/**` and `packages/core/src/lib/**` only when they explain a finding.

## Non-goals

- Refactors outside the three modules.
- Architectural rewrites (new abstractions, new packages).
- Performance work that is not a security / correctness concern.
- Fixing more than one finding in this PR — the rest become follow-up issues.

## Risks

- "CRM" in the brief is ambiguous in this codebase. Treating it as `customers` (the reference CRUD module called out in `AGENTS.md`), not `customer_accounts` (the portal-side module). If the maintainer meant `customer_accounts`, the audit can be re-run with that scope.
- Audit may surface a high-severity issue whose safe fix is too big for one PR. If so, file the issue and pick the next safe candidate; document the demotion in NOTIFY.
- The janitor-managed branch name (`task/<uuid>`) does not match the skill's `fix/`/`feat/` convention. Keeping the existing name to respect the janitor harness; PR title will still follow conventional commits.

## External References

- None (`--skill-url` not used).
