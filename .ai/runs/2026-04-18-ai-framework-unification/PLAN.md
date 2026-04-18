# Execution Plan — AI Framework Unification

**Date:** 2026-04-18
**Slug:** `ai-framework-unification`
**Branch:** `feat/ai-framework-unification`
**Owner:** @peter (piotr.karwatka@gmail.com)

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
  `proofs/<step-id>/`.
- Enforce a 1:1 step-to-commit discipline and per-commit verification proofs
  (typecheck, unit tests, Playwright + screenshot when UI-facing **and** env
  is runnable — never a dev-blocking requirement).
- Require live `HANDOFF.md` + append-only `NOTIFY.md` maintenance.
- Cap subagent parallelism at 2 (dev + reviewer) with conflict avoidance as
  the priority.
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
  legacy flat-file `.ai/runs/<date>-<slug>.md` layout. Mitigated by
  documenting the fallback in `auto-continue-pr` step 1 and migrating on
  first resume.
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
  `.ai/runs/README.md` to adopt per-spec run folders with PLAN/HANDOFF/NOTIFY
  + per-commit proofs + 2-subagent cap. Already landed as part of this
  PR's preamble; the change sits in the working tree awaiting the branch
  commit.

### Phase 2 — `ai-framework` unification (to be defined)

- **Step 2.1** _Placeholder — scope pending user direction._

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Each Step is 1:1 with a commit. Do not rename step titles.

### Phase 1: Skill harness refresh

- [x] 1.1 Rework auto-create-pr/auto-continue-pr and sibling skills to per-spec run folders — bacbc59ec
- [x] 1.2 Fix placeholder timestamps in NOTIFY.md / HANDOFF.md with real UTC times — 4a782bbd1
- [x] 1.3 Tighten `in-progress` label discipline in auto-create-pr and dogfood on PR #1593 — 98ec6abb2
- [ ] 1.4 Flatten verification layout: replace `proofs/<step>/` with `step-<X.Y>-checks.md` + optional `step-<X.Y>-artifacts/` next to PLAN.md

### Phase 2: ai-framework unification (to be defined)

- [ ] 2.1 Placeholder — expand once user provides direction
