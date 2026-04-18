# Step 1.2 checks — rephase PLAN.md to cover the full ai-tooling spec

**Step:** 1.2 Rephase `PLAN.md` to cover the full
`.ai/specs/2026-04-11-unified-ai-tooling-and-subagents.md` spec (Phases 2–5)
and rename the PR title to the `ai-framework-unification` main goal.
**Scope:** docs-only — `.ai/runs/2026-04-18-ai-framework-unification/PLAN.md`
plus GitHub PR #1593 metadata.

## What changed

- `PLAN.md` Tasks table expanded from 3 rows to 46 rows:
  - 1 row rolling up Phase 1 (Step 1.1 = skill harness foundation, done).
  - 1 row for this rephasing Step itself (1.2).
  - **Phase 2** (5 Steps, 2.1–2.5) = source spec Phase 0 "Alignment
    Prerequisite" (type + helper + generator + restored loader +
    attachment/prompt primitives).
  - **Phase 3** (13 Steps, 3.1–3.13) = source spec Phase 1 "Runtime + Tools
    + AI SDK DX", grouped by the spec's own Workstream A (3.1–3.3),
    Workstream B (3.4–3.6), Workstream C (3.7–3.13).
  - **Phase 4** (11 Steps, 4.1–4.11) = source spec Phase 2 "Playground +
    Settings + First Module Agents", grouped by Workstream A (4.1–4.3),
    Workstream B (4.4–4.6), Workstream C (4.7–4.11).
  - **Phase 5** (19 Steps, 5.1–5.19) = source spec Phase 3 "Production
    Hardening + Mutation Approval + Expansion", grouped by Workstream A
    (5.1–5.2), Workstream B (5.3–5.4), Workstream C (5.5–5.14),
    Workstream D (5.15–5.19). Covers the D16 pending-action contract end
    to end (entity + migration + `prepareMutation` + three routes + four
    UI parts + typed events + cleanup worker + first mutation-capable
    agent) plus the D18 bulk-edit demo.
- `PLAN.md` Implementation Plan section rewritten to mirror the table
  one-to-one, preserving the spec's own numbering so reviewers can trace
  each Step back to a numbered deliverable in the source spec.
- `PLAN.md` Scope section expanded with a per-Phase purpose + exit-criteria
  block for Phases 2–5.
- `PLAN.md` Risks section refreshed to call out the contract-surface audit
  required before Steps 2.1–2.4, 5.5, and 5.7–5.9, plus the encryption /
  tenant-isolation constraints on `AiPendingAction` / attachments /
  `resolvePageContext`.
- Source spec path added as a top-of-file metadata row so the plan and the
  spec are cross-linked.
- Non-goals section pinned to the spec's D1/D10 decisions (no new
  top-level package, no per-module MCP, no RSC `streamUI`, D17 queue is
  design-only).
- GitHub PR #1593 title updated from
  `feat(ai-framework): AI framework unification — Phase 1 skill harness foundation`
  to `feat(ai-framework): AI framework unification` so the title names
  the overall goal rather than the first phase's delivery mechanism.

## Verification

- **Typecheck / unit tests / Playwright / i18n:** N/A — docs-only change
  to `PLAN.md` plus external PR metadata.
- **Tasks-table schema sanity:** re-read the written file and confirmed
  every row has five pipe-separated cells (`Phase | Step | Title | Status
  | Commit`), only one row is `done` with a commit SHA, and every other
  row is `todo` with `—`. The `## Tasks` fence is the first H2 below the
  metadata block, matching the authoritative-source rule.
- **Spec cross-references:** spot-checked Step titles against the source
  spec §7 (D18 tool tables), §9.8 (batch mutation flow), §10 (D18
  merchandising demo), and the Implementation Plan Phase 0–3
  Workstream lists. Every Phase 2–5 row names the numbered spec
  deliverable it maps to.
- **Audit trail preserved:** the five historical `step-1.1-checks.md`
  through `step-1.5-checks.md` files remain on disk; the five Phase 1
  commits (`bacbc59ec` → `93440ec79`) remain in git history. The
  Implementation Plan's Phase 1 block enumerates those SHAs so nothing
  is lost in the Tasks-table rollup.
- **PR metadata:** `gh pr edit 1593 --title …` applied; `gh pr view
  1593 --json title` confirms the rename.

## Artifacts

- None. Docs-only change.
