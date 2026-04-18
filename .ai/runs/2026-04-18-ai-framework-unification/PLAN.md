# Execution Plan — AI Framework Unification

**Date:** 2026-04-18
**Slug:** `ai-framework-unification`
**Branch:** `feat/ai-framework-unification`
**Owner:** @peter (piotr.karwatka@gmail.com)

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `auto-continue-pr`. Step ids are immutable once a Step has a commit.

| Phase | Step | Title | Status | Commit |
|-------|------|-------|--------|--------|
| 1 | 1.1 | Rework auto-create-pr/auto-continue-pr and sibling skills to per-spec run folders | done | bacbc59ec |
| 1 | 1.2 | Fix placeholder timestamps in NOTIFY.md / HANDOFF.md with real UTC times | done | 4a782bbd1 |
| 1 | 1.3 | Tighten `in-progress` label discipline in auto-create-pr and dogfood on PR #1593 | done | 98ec6abb2 |
| 1 | 1.4 | Flatten verification layout: replace `proofs/<step>/` with `step-<X.Y>-checks.md` + optional `step-<X.Y>-artifacts/` next to PLAN.md | done | 6a1afab69 |
| 1 | 1.5 | Require a top-of-file Tasks table in PLAN.md as the single source of truth for Step status; update skills and this plan | todo | — |
| 2 | 2.1 | Placeholder — expand once user provides direction | todo | — |

## Goal

Unify the AI-facing framework surfaces in Open Mercato so every agent-oriented
capability (skills, MCP tools, AI assistant, automation runbooks, and
supporting specs) hangs off one coherent contract instead of the current
scatter of ad-hoc skills, separate MCP tools, and one-off scripts.

The precise scope of Phase 2+ will be defined once the user provides
direction after the Phase 1 skill-harness refresh lands. Until then Phase 2+
is a placeholder — it MUST be expanded before any code-changing work.

## Scope (Phase 1 only, confirmed)

- Rework `auto-create-pr` and `auto-continue-pr` to use per-spec run folders
  (`.ai/runs/<date>-<slug>/`) with `PLAN.md`, `HANDOFF.md`, `NOTIFY.md`, and
  flat `step-<X.Y>-checks.md` (+ optional `step-<X.Y>-artifacts/`) verification
  files.
- Enforce a 1:1 step-to-commit discipline and per-commit verification
  (typecheck, unit tests, Playwright + screenshot when UI-facing **and** env
  is runnable — never a dev-blocking requirement).
- Require live `HANDOFF.md` + append-only `NOTIFY.md` maintenance.
- Cap subagent parallelism at 2 (dev + reviewer) with conflict avoidance as
  the priority.
- Tighten the `in-progress` label discipline in `auto-create-pr` so the
  three-signal lock (assignee + label + claim comment) is held throughout
  the run and released in a trap/finally.
- Add a top-of-file Tasks table to `PLAN.md` as the authoritative Step-status
  source, replacing the bottom-of-file Progress checkbox section.
- Migrate sibling skills (`auto-sec-report`, `auto-qa-scenarios`,
  `auto-update-changelog`) to the new folder layout or confirm their existing
  filters remain correct.
- Refresh `.ai/runs/README.md` to document the new contract.

## Non-goals (Phase 1)

- No application code changes (`packages/*`, `apps/*`).
- No database migrations.
- No new specs under `.ai/specs/` — this is a process/runbook change.

## Risks

- **Back-compat of tracking plans**: existing open PRs may still use the
  legacy `.ai/runs/<date>-<slug>.md` flat-file layout or the bottom-of-file
  Progress checkbox format. Mitigated by documenting both fallbacks in
  `auto-continue-pr` and migrating on first resume.
- **Dogfooding deviation**: this run is being executed inside the user's
  primary worktree at the user's explicit request (they want to continue
  in-place). The new skill forbids that by default; this is a one-time
  deviation documented in `NOTIFY.md`.
- **Phase 2+ under-specified**: the actual `ai-framework unification`
  scope has not yet been provided. The plan MUST be expanded before any
  Phase 2 commits.

## External References

- None for Phase 1.

## Source spec

- None — this is a runbook/process change, not an architectural spec. If
  Phase 2+ requires an architectural decision, a spec under `.ai/specs/`
  will be added and linked here.

## Implementation Plan

### Phase 1 — Skill harness refresh

- **Step 1.1** Rework `auto-create-pr`, `auto-continue-pr`, sibling skills
  (`auto-sec-report`, `auto-qa-scenarios`, `auto-update-changelog`), and
  `.ai/runs/README.md` to adopt per-spec run folders with PLAN/HANDOFF/NOTIFY.
- **Step 1.2** Repair placeholder UTC timestamps in `NOTIFY.md` and
  `HANDOFF.md` derived from the real session timeline.
- **Step 1.3** Add the three-signal `in-progress` lock (assignee + label +
  claim comment) to `auto-create-pr` and dogfood it on PR #1593.
- **Step 1.4** Flatten the verification layout: `step-<X.Y>-checks.md` (and
  optional `step-<X.Y>-artifacts/`) sit next to `PLAN.md`; no `proofs/`
  subfolder, no per-Step subfolders for checks.
- **Step 1.5** Introduce a top-of-file `## Tasks` table in `PLAN.md` as the
  authoritative Step-status source. Replace the old bottom-of-file
  `## Progress` checklist, update `auto-create-pr` and `auto-continue-pr` to
  read/write the table, update `.ai/runs/README.md`.

### Phase 2 — `ai-framework` unification (to be defined)

- **Step 2.1** _Placeholder — scope pending user direction._
