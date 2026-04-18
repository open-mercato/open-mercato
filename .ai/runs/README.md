# Execution Plans (`.ai/runs/`)

This folder contains **execution plans** created by the `auto-create-pr` skill — lightweight tracking documents with Progress checklists that enable `auto-continue-pr` to resume interrupted runs.

## These are NOT specs

Architectural specifications live in `.ai/specs/`. Execution plans here are agent-internal tracking artifacts: they record what to do, in what order, and which steps have been completed (with commit SHAs).

## Lifecycle

- Created by `auto-create-pr` as the first commit on a feature branch
- Updated during implementation (Progress checkboxes flipped)
- Referenced by `auto-continue-pr` via the `Tracking plan:` line in the PR body
- Remain in the repo after PR merge as historical record

## Format

Each plan includes:
- **Goal** and **Scope** (brief summary)
- **Implementation Plan** (phases and steps)
- **Progress** section with checkboxes (`- [ ]` / `- [x]`) and commit SHAs
- **Source spec** reference (when implementing an existing spec from `.ai/specs/`)

## Two layouts coexist

- **Flat file** (`.ai/runs/<date>-<slug>.md`) — used by the default `auto-create-pr` / `auto-continue-pr` skills. A single markdown file with a `## Progress` checklist. Resumed by matching unchecked boxes.
- **Per-run folder** (`.ai/runs/<date>-<slug>/`) — used by the `-sophisticated` variants (`auto-create-pr-sophisticated`, `auto-continue-pr-sophisticated`). Contains `PLAN.md` (with a top-of-file `## Tasks` table), `HANDOFF.md` (rewritten after every Step), append-only `NOTIFY.md`, `step-<X.Y>-checks.md` verification logs per Step, and optional `step-<X.Y>-artifacts/` folders. Resumed by the first `Status != done` row in the Tasks table.

Both layouts live side-by-side; the skill that created a run is responsible for reading it back.
