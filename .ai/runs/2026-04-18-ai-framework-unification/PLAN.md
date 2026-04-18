# Execution Plan — AI Framework Unification

**Date:** 2026-04-18
**Slug:** `ai-framework-unification`
**Branch:** `feat/ai-framework-unification`
**Owner:** @peter (piotr.karwatka@gmail.com)

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `auto-continue-pr`. Step ids are immutable once a Step has a commit.

| Phase | Step | Title | Status | Commit |
|-------|------|-------|--------|--------|
| 1 | 1.1 | Skill harness foundation: per-spec run folders, flat `step-<X.Y>-checks.md`, three-signal in-progress lock, top-of-file Tasks table | done | 93440ec79 |
| 1 | 1.2 | Compact Phase 1 plan to a single step and rename PR to the `ai-framework-unification` main goal | todo | — |
| 2 | 2.1 | Placeholder — expand once user provides direction | todo | — |

## Goal

Unify the AI-facing framework surfaces in Open Mercato so every agent-oriented
capability (skills, MCP tools, AI assistant, automation runbooks, and
supporting specs) hangs off one coherent contract instead of the current
scatter of ad-hoc skills, separate MCP tools, and one-off scripts.

Phase 1 lays the process/runbook foundation that every subsequent AI-framework
change will flow through: a single, resumable, auditable way for autonomous
agents to deliver PRs. Phase 2+ is the actual AI-framework unification work —
scope pending user direction.

## Scope (Phase 1, confirmed and landed)

Phase 1 was a single, unified piece of foundation work — delivered as a
sequence of small commits, now rolled up into one Step in this table for
clarity. The concrete outcomes:

- `.ai/runs/<date>-<slug>/` per-spec run folder layout with `PLAN.md`,
  `HANDOFF.md`, and append-only `NOTIFY.md` as a uniform contract.
- Flat verification layout: `step-<X.Y>-checks.md` next to `PLAN.md` (required
  per Step) + optional `step-<X.Y>-artifacts/` only when real artifacts exist.
  No `proofs/` subfolder. Full-gate output under `final-gate-checks.md`.
- 1:1 step-to-commit discipline with per-commit verification (typecheck + unit
  tests always; Playwright + screenshot when UI-facing **and** env runnable —
  never a dev-blocking requirement).
- `HANDOFF.md` rewritten after every Step so a fresh agent can resume in
  <30 seconds; `NOTIFY.md` is append-only UTC-timestamped log.
- Subagent parallelism capped at 2 (dev + reviewer), conflict avoidance over
  speed.
- Three-signal `in-progress` lock in `auto-create-pr` (assignee + label +
  claim comment) held throughout the run, temporarily released around
  `auto-review-pr`, and released in a trap/finally.
- Top-of-file `## Tasks` markdown table in `PLAN.md` (Phase | Step | Title |
  Status | Commit) as the authoritative status source, replacing the legacy
  bottom-of-file `## Progress` checklist. Legacy Progress section tolerated
  as a one-shot fallback for pre-migration PRs.
- Sibling skills (`auto-sec-report`, `auto-qa-scenarios`,
  `auto-update-changelog`) migrated or confirmed compatible with the new
  layout. `.ai/runs/README.md` documents the full contract.

## Non-goals (Phase 1)

- No application code changes (`packages/*`, `apps/*`).
- No database migrations.
- No new specs under `.ai/specs/` — this is a process/runbook change.

## Risks

- **Back-compat of tracking plans**: pre-migration PRs used the flat-file
  layout and/or the bottom-of-file Progress checklist. Mitigated by explicit
  fallbacks in `auto-continue-pr`, which migrates stragglers on first resume.
- **Dogfooding deviation**: this run was executed in the user's primary
  worktree at the user's explicit request. The new skill forbids that by
  default; documented as a one-time exception in `NOTIFY.md`.
- **Phase 2+ under-specified**: the actual `ai-framework unification` scope
  has not yet been provided. The plan MUST be expanded before any Phase 2
  commits.

## External References

- None for Phase 1.

## Source spec

- None — Phase 1 is a runbook/process change, not an architectural spec. If
  Phase 2+ requires an architectural decision, a spec under `.ai/specs/`
  will be added and linked here.

## Implementation Plan

### Phase 1 — Skill harness foundation

- **Step 1.1** Skill harness foundation. Landed as five incremental commits
  to keep review easy; rolled up as one Step in the Tasks table for
  readability. Commit breadcrumbs (newest last):
  - `bacbc59ec` — initial rework of `auto-create-pr` / `auto-continue-pr` and
    sibling skills to per-spec run folders.
  - `4a782bbd1` — repair placeholder UTC timestamps in `NOTIFY.md` /
    `HANDOFF.md` to match real session time.
  - `98ec6abb2` — add three-signal `in-progress` lock discipline to
    `auto-create-pr`; dogfooded on this PR.
  - `6a1afab69` — flatten verification layout: `step-<X.Y>-checks.md` +
    optional `step-<X.Y>-artifacts/` replace the `proofs/<step-id>/` nesting.
  - `93440ec79` — introduce the top-of-file `## Tasks` table in `PLAN.md` as
    the authoritative Step-status source; update both skills to read/write
    the table.
  - Per-commit verification notes remain as `step-1.1-checks.md`,
    `step-1.2-checks.md`, `step-1.3-checks.md`, `step-1.4-checks.md`,
    `step-1.5-checks.md` in this run folder for audit.
- **Step 1.2** Compact Phase 1 in `PLAN.md` to a single Step row, rewrite
  the Implementation Plan to reflect that rollup, and rename the PR so the
  title names the overall `ai-framework-unification` goal (the skill harness
  was the first step of it, not the whole goal).

### Phase 2 — `ai-framework` unification (to be defined)

- **Step 2.1** _Placeholder — scope pending user direction._
