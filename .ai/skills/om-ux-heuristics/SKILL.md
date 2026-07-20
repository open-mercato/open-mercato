---
name: om-ux-heuristics
description: "Critique an Open Mercato *.mockup.json screen against the om-ux-product-design audit dimensions (Nielsen's 10, the project's executable UX contracts, the anti-pattern blocklist, the state matrix) and write the results INTO the document as evidence-tagged `finding` annotations rendered in the mockup ledger. Use when asked to 'review this mockup', 'run a UX critique', 'check the heuristics', 'audit this screen before implementation', or after om-ds-mockup composes or edits a screen. Triggers on 'heuristics', 'UX critique', 'usability findings', 'mockup review', 'przejrzyj makietę'. Pre-implementation counterpart of the synthetic-user walkthroughs."
---

# UX Heuristics — Encoded Critique for Mockup Documents

You are the composer-facing arm of the **om-ux-product-design** decision system (`.ai/skills/om-ux-product-design/SKILL.md` — read it first; its evidence hierarchy, weighing rule, and anti-pattern blocklist bind every finding you write). You critique a mockup document (`*.mockup.json`, spec `.ai/specs/2026-07-05-ds-live-mockup-composer.md`) and write findings INTO the document as the Phase 2 `finding` annotation type. Findings render in the same margin-rail + ledger language as statuses — severity-toned rail segments and ledger entries with an uppercase evidence tag; never anything drawn on content. This critique is static and pre-implementation; persona walkthroughs (`2026-07-07-ux-synthetic-user-walkthroughs.md`) verify the shipped flow post-implementation with the same severity scale.

## I/O contract (composable pipeline stage)

- **Consumes:** one `*.mockup.json` document (validated by `packages/core/src/modules/design_system/mockups/schema.ts`).
- **Produces:** the SAME document plus `findings` arrays on leaves and/or `documentFindings` at the top level. You NEVER edit layout, entries, variants, props, `status`, `userStory`, or `note` — findings only.
- **Chain position:** flows → compose (`om-ds-mockup`) → **heuristics** → copy (`om-ux-copy`) → iterate.

## The finding shape

```jsonc
{
  "id": "f-om-empty-state-next-action--people-table", // unique in the document; see naming below
  "heuristicId": "om-empty-state-next-action",
  "severity": "high",            // low | medium | high | critical — see weighing below
  "summary": "…",                // ≤300 chars — problem + pattern, cite the block
  "suggestion": "…",             // ≤500 chars — tradeoff + acceptance criterion
  "atHash": "<contentHash>",     // REQUIRED — see staleness rules
  "evidence": "heuristic"        // REQUIRED for every finding you write (schema-optional for BC)
}
```

### Three non-negotiables on every finding

1. **Severity by impact, never taste.** Weight = impact × frequency × reach, mapped from the umbrella scale: BLOCKER (task cannot be completed) → `critical`, MAJOR (high risk of error/abandonment/exclusion) → `high`, MODERATE (noticeable slowdown/confusion) → `medium`, MINOR (local/cosmetic) → `low`. "I would not have designed it this way" is not a finding.
2. **An evidence tag** from the hierarchy: `product | standard | platform | research | heuristic | assumption`. Tag honestly — a Nielsen-based observation is `heuristic`, a WCAG requirement is `standard`, a GOV.UK-pattern mismatch is `research`, and anything you could not verify is `assumption`. Never present an assumption as research; assumption-tagged findings are counted separately in the ledger header because they demand verification.
3. **The quad, compressed for a ledger entry.** `summary` = problem → pattern ("X blocks the task; use pattern Y"); `suggestion` = tradeoff → acceptance criterion ("costs Z; done when the user can …"). A finding whose suggestion has no observable acceptance condition is not finished.

### atHash and staleness — non-negotiable

`atHash` is the document's **content hash**: sha256 over the findings-free canonical serialization (`stableContentString` in `mockups/schema.ts`), NOT the file hash. Read it from `GET /api/design_system/mockups/<slug>` → `contentHash`, or compute it with `computeContentHash` from `mockups/loader.ts`. Writing findings does not change it — a critique must not stale-flag itself. When the screen later changes, the ledger dims your findings with a "Stale" label instead of silently trusting them; that is the feature, never fake a fresh hash on old findings.

### Deterministic ids and idempotent re-runs

- Finding id = `f-<heuristicId>--<blockId>` for block findings, `f-<heuristicId>` for screen-level ones (`findingIdFor` in `mockups/heuristics.ts`). Multiple findings of one heuristic on one block get `-2`, `-3` suffixes.
- **Re-running replaces your own findings and nothing else**: remove findings whose `heuristicId` you are re-checking (matched by heuristic id + block), then write the fresh set. Hand-written findings under other heuristic ids survive untouched. The mechanical engine (`applyMechanicalFindings`) implements exactly this — mirror its semantics for judgment findings.

## The checklist (versioned here)

### Mechanical checks — deterministic, implemented in `mockups/heuristics.ts`

Run these through the code, not by eyeballing — `runMechanicalChecks(document)` / `applyMechanicalFindings(document, contentHash)`; they are unit-tested, byte-stable, and always emit `evidence: 'heuristic'`:

| Id | Check | Severity |
|---|---|---|
| `om-empty-state-next-action` | Every list block (`table`-family entries) declares an empty state with a next action — an `/empty/i` prop key or a note mentioning the empty state | high |
| `om-no-dead-ends` | The screen has at least one action/navigation block (header, buttons, tabs, filter bar, pagination) — otherwise it is a dead end | medium |
| `om-placeholder-only-label` | No prop object carries a placeholder-ish key without a label/title sibling — a placeholder is never the only label | high |
| `om-vague-action-label` | No action-entry block is labeled with a bare OK/Next/Send-class verb (`VAGUE_ACTION_LABELS`) — buttons name the action | medium |

### Judgment checks — applied by you; cite the dimension, quote the offending block, tag the evidence

The audit dimensions from the umbrella system, as far as a static mockup exposes them:

- **Status visibility** (`nielsen-01`) — after each significant action mocked on the screen: does the user learn accepted/processing/saved/what-next? `om-progress-over-1s` — operations that can take >1s show progress.
- **Control and undo** (`nielsen-03`) — `om-destructive-confirm-undo` — destructive actions confirm AND offer undo; prefer Undo over confirmation theater; back/cancel paths exist; irreversible actions marked.
- **Error prevention** (`nielsen-05`) — formats suggested, disallowed options absent, consequences visible before commit, review step before irreversible submits.
- **Forms and validation** (`nielsen-09`) — persistent labels, only-needed fields, error copy that names the fix and points at the field, typed data preserved, error summary for long forms.
- **Recognition over recall** (`nielsen-06`) — options and sample values visible; nothing requires remembering a previous screen.
- **Progressive disclosure** (`nielsen-08`) — the current task's needs shown, advanced on demand; costs/conditions/consequences never hidden.
- **State matrix vs the mockup's blocks** — walk `references/state-matrix.md` (umbrella skill) against what the blocks and notes actually declare; absent states are findings, not assumptions of competence.
- **Content** (`nielsen-02`, `nielsen-04`) — headings say what the user can do, action labels name actions, naming consistent across blocks and screens; hand microcopy depth to `om-ux-copy`.
- **Accessibility markers observable in a mockup** — icon-only actions without names, color-only status, unlabeled inputs, missing captions; tag WCAG-grounded ones `standard`. Implementation-level checks (focus order, announcements) become suggested acceptance criteria, not findings.
- Remaining blocklist anti-patterns (`.ai/skills/om-ux-product-design/references/anti-patterns.md`) where the document gives you enough context: error-without-fix, disabled-without-reason, unlabeled icons, silent auto-execution, hidden costs — use the nearest `nielsen-*` id or project contract id (`om-dialog-keyboard-contract`, …).
- Remaining Nielsen ids (`nielsen-07`, `nielsen-10`) where relevant.

## Workflow

1. Load the document and its `contentHash` (GET route or loader).
2. Apply the mechanical pass: `applyMechanicalFindings(document, contentHash)` semantics — deterministic, replaces only its own findings.
3. Walk the tree for the judgment checks; attach block findings to the offending leaf, screen-level observations (flow order, dead ends spanning blocks, missing states) to `documentFindings`. Every finding: impact-weighed severity + evidence tag + compressed quad.
4. Write the document back: edit the JSON directly, or dev-mode `PUT /api/design_system/mockups/<slug>/annotations` with `blocks: [{ id, status, …, findings }]` and optional `documentFindings` (the PUT replaces findings wholesale per block — send the complete arrays; `evidence` round-trips).
5. Validate: `yarn workspace @open-mercato/core test --testPathPatterns design_system` — the document must still pass schema + integrity.
6. Report the findings to the reviewer grouped by severity, stale count AND assumption count included. The ledger shows the same numbers; assumption-tagged findings are your verification backlog, name it explicitly.

## Never

- Never edit anything except `findings` / `documentFindings`.
- Never invent an `atHash` — always the current `contentHash`.
- Never write a finding without an evidence tag, and never tag guesswork as anything but `assumption`.
- Never weigh a finding by taste — only impact × frequency × reach.
- Never delete another author's findings under heuristic ids you did not re-check.
- Never mark a draft screen "reviewed" by clearing findings without fixing the blocks.
