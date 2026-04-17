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
