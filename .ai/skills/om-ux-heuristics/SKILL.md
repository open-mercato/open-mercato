---
name: om-ux-heuristics
description: "Critique an Open Mercato *.mockup.json screen against an encoded UX heuristic checklist (Nielsen's 10 + the project's executable UX contracts) and write the results INTO the document as `finding` annotations rendered in the mockup ledger. Use when asked to 'review this mockup', 'run a UX critique', 'check the heuristics', 'audit this screen before implementation', or after om-ds-mockup composes or edits a screen. Triggers on 'heuristics', 'UX critique', 'usability findings', 'mockup review', 'przejrzyj makietę'. Pre-implementation counterpart of the synthetic-user walkthroughs."
---

# UX Heuristics — Encoded Critique for Mockup Documents

You critique a mockup document (`*.mockup.json`, spec `.ai/specs/2026-07-05-ds-live-mockup-composer.md`) and write findings INTO the document as the Phase 2 `finding` annotation type. Findings render in the same margin-rail + ledger language as statuses — severity-toned rail segments and ledger entries; never anything drawn on content. This critique is static and pre-implementation; persona walkthroughs (`2026-07-07-ux-synthetic-user-walkthroughs.md`) verify the shipped flow post-implementation with the same severity scale.

## I/O contract (composable pipeline stage)

- **Consumes:** one `*.mockup.json` document (validated by `packages/core/src/modules/design_system/mockups/schema.ts`).
- **Produces:** the SAME document plus `findings` arrays on leaves and/or `documentFindings` at the top level. You NEVER edit layout, entries, variants, props, `status`, `userStory`, or `note` — findings only.
- **Chain position:** flows → compose (`om-ds-mockup`) → **heuristics** → copy (`om-ux-copy`) → iterate.

## The finding shape

```jsonc
{
  "id": "f-om-empty-state-next-action--people-table", // unique in the document; see naming below
  "heuristicId": "om-empty-state-next-action",
  "severity": "high",            // low | medium | high | critical — shared with the walkthrough spec
  "summary": "…",                // ≤300 chars, cite the block
  "suggestion": "…",             // optional, ≤500 chars, actionable
  "atHash": "<contentHash>"      // REQUIRED — see staleness rules
}
```

### atHash and staleness — non-negotiable

`atHash` is the document's **content hash**: sha256 over the findings-free canonical serialization (`stableContentString` in `mockups/schema.ts`), NOT the file hash. Read it from `GET /api/design_system/mockups/<slug>` → `contentHash`, or compute it with `computeContentHash` from `mockups/loader.ts`. Writing findings does not change it — a critique must not stale-flag itself. When the screen later changes, the ledger dims your findings with a "Stale" label instead of silently trusting them; that is the feature, never fake a fresh hash on old findings.

### Deterministic ids and idempotent re-runs

- Finding id = `f-<heuristicId>--<blockId>` for block findings, `f-<heuristicId>` for screen-level ones (`findingIdFor` in `mockups/heuristics.ts`). Multiple findings of one heuristic on one block get `-2`, `-3` suffixes.
- **Re-running replaces your own findings and nothing else**: remove findings whose `heuristicId` you are re-checking (matched by heuristic id + block), then write the fresh set. Hand-written findings under other heuristic ids survive untouched. The mechanical engine (`applyMechanicalFindings`) implements exactly this — mirror its semantics for judgment findings.

## The checklist (versioned here)

### Mechanical checks — deterministic, implemented in `mockups/heuristics.ts`

Run these through the code, not by eyeballing — `runMechanicalChecks(document)` / `applyMechanicalFindings(document, contentHash)`; they are unit-tested and their output is byte-stable:

| Id | Check | Severity |
|---|---|---|
| `om-empty-state-next-action` | Every list block (`table`-family entries) declares an empty state with a next action — an `/empty/i` prop key or a note mentioning the empty state | high |
| `om-no-dead-ends` | The screen has at least one action/navigation block (header, buttons, tabs, filter bar, pagination) — otherwise it is a dead end | medium |

### Judgment checks — applied by you, cite the heuristic and quote the offending block

- `nielsen-01` … `nielsen-10` — Nielsen's ten (visibility of status, real-world match, user control/freedom, consistency, error prevention, recognition over recall, flexibility, minimalism, error recovery, help).
- `om-destructive-confirm-undo` — destructive actions confirm AND offer undo.
- `om-progress-over-1s` — operations that can take >1s show progress.
- `om-dialog-keyboard-contract` — dialogs honor Escape / Cmd+Enter.

Severity guide: `critical` = the flow cannot be completed as mocked; `high` = a contract violation (empty states, undo, progress); `medium` = friction or inconsistency; `low` = polish.

## Workflow

1. Load the document and its `contentHash` (GET route or loader).
2. Apply the mechanical pass: `applyMechanicalFindings(document, contentHash)` semantics — deterministic, replaces only its own findings.
3. Walk the tree for the judgment checks; attach block findings to the offending leaf, screen-level observations (flow order, dead ends spanning blocks) to `documentFindings`.
4. Write the document back: edit the JSON directly, or dev-mode `PUT /api/design_system/mockups/<slug>/annotations` with `blocks: [{ id, status, …, findings }]` and optional `documentFindings` (the PUT replaces findings wholesale per block — send the complete arrays).
5. Validate: `yarn workspace @open-mercato/core test --testPathPatterns design_system` — the document must still pass schema + integrity.
6. Report the findings to the reviewer grouped by severity, stale count included. The ledger shows the same numbers.

## Never

- Never edit anything except `findings` / `documentFindings`.
- Never invent an `atHash` — always the current `contentHash`.
- Never delete another author's findings under heuristic ids you did not re-check.
- Never mark a draft screen "reviewed" by clearing findings without fixing the blocks.
