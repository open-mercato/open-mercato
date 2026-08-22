# Module Fact-Sheet Sectioned Reading

- **Status:** In progress
- **Date:** 2026-08-13
- **Parent:** [Module Facts Auto-Discovery](2026-07-06-module-facts-auto-discovery.md)
- **Related:** [Complete Source-Linked Module Extension Contracts](2026-08-02-module-facts-extension-surface-completeness.md), [Module Facts Exact Unified Override Targets](2026-08-02-module-facts-exact-override-targets.md), PR #5267, issue #5251
- **Scope:** generated module fact-sheet readability under agent read-tool caps — in-file navigation affordances first, an optional directory split second

## TLDR

Generated module fact-sheets routinely exceed a single agent read-tool call (13 sheets over 50 KB in a current build; `customers.md` is 218 KB), and truncation is silent: the #5251 shared session worked from a 50 k-character preview of a fact-sheet without noticing. PR #5267 mitigated this with one routed sentence ("Big fact-sheets: read in sections."), which relies entirely on model discipline. This spec makes truncation detectable and sectioned reading mechanical **without changing the one-file-per-module layout**: a generated `## Contents` index with per-section line anchors and sizes, a terminal end-of-facts marker, source-link label compression, and `###` sub-anchors inside oversized sections. A full split into a per-module directory of section files plus an index is specified as a conditional Phase 2, because it invalidates a very large pinned contract surface (363 literal `.ai/guides/modules/<id>.md` references in the harness `cases.json` alone) for a benefit Phase 1 already delivers in-place.

## Problem Statement

`renderModuleFactsMarkdown` (`packages/cli/src/lib/generators/module-facts.ts`) emits one flat markdown file per module into `dist/agentic/guides/modules/<id>.md`, copied into scaffolded apps as `.ai/guides/modules/<id>.md`. Measured on the build at PR #5267's head (56 enabled template modules):

- 13 sheets exceed 50 KB; `customers.md` 218 KB, `sales.md` 175 KB, `customer_accounts.md` 125 KB, `catalog.md` 115 KB, `wms.md` 109 KB. Total ~2.1 MB across the emitted set.
- Sizes are section-skewed: `customers.md` has 27 `##` sections, but `## Exact override targets` alone is 62 KB and `## UMES hosts` 41 KB. `sales.md`'s override-target section is 57 KB.
- ~48 % of `customers.md` (104 KB) is markdown source-link syntax — the full `node_modules/@open-mercato/...` path written twice per table row (label and href).

Agent CLIs cap single-file reads (≈50 k characters in the Kimi session; 2 000 lines for Claude Code's Read; others vary). Three failure modes follow:

1. **Silent truncation.** A capped read returns the head of the sheet with no reliable signal that sections are missing. The sheet's tail carries the sections most recently added (override targets, domain commands, encryption) — precisely the facts extension work needs.
2. **No seek target.** Even an agent that knows the sheet is big cannot jump to a section without scanning: sections have no anchors, no offsets, and their order is only documented in generator source.
3. **Wasted context.** Loading 218 KB to answer a question about one entity burns most of a context window on repeated path boilerplate.

The routed hint from PR #5267 addresses only failure mode 1, and only probabilistically.

## Resolved assumptions (autonomous defaults)

| # | Question | Applied default | Rationale | Confirm? |
|---|---|---|---|---|
| Q1 | Split into per-section files now? | No — Phase 1 stays in-file; the split is Phase 2 behind an explicit trigger. | The single-file path is pinned by ~30 test assertions, 363 `cases.json` references, two build scripts, and two injection mirrors (inventory below); Phase 1 achieves detectability and seekability without touching any of it. | ok |
| Q2 | Compress source links by dropping them? | No — shorten only the **label** to a source-root-relative path; keep the full href. | Source links are the harness's "fact-first" navigation contract (`module-facts.bc-guard.test.ts` link-exactness); labels are pure redundancy since every sheet declares `Source root:` in its header. | ok |
| Q3 | Line anchors or byte offsets in the Contents index? | Line numbers (plus approximate KB per section). | Every agent read tool addresses lines (`offset`/`limit`, `sed -n`); byte offsets are only addressable via shell. Sheets are generated do-not-edit files, so anchors cannot drift. | ok |
| Q4 | Where does the "check the end marker" guidance live? | In the sheet itself (header line) and `agentic/guides/architecture.md`; the 12 KiB root keeps the existing compact hint. | The classic Codex root sits at 12 266/12 288 bytes (22 B headroom in the one-extra-module scenario, `agent-instruction-budget.test.ts`); no room for a longer routed sentence. | ok |

## Design

### Phase 1 — in-file sectioned reading affordances (recommended, unconditional)

All changes live in `renderModuleFactsMarkdown` and are additive to the existing layout. No path, filename, or consumer contract changes.

1. **`## Contents` index.** Emitted directly after the `Source root:` line: one bullet per emitted section, in order, with the section's start line in the final rendered file and its approximate size — e.g. `- Exact override targets — L1480, ~62 KB`. Rendering is two-pass (render body, compute line starts, prepend index with a fixed self-size so numbering is stable and deterministic, satisfying the determinism assertion in `module-facts.bc-guard.test.ts`). A one-line instruction follows the index: `Read caps: a read that does not reach the end-of-facts marker was truncated — re-read the missing sections by their line anchors.`
2. **End-of-facts marker.** Final line of every sheet: `<!-- end module facts: <module> — <n> sections -->`. Together with the Contents index this converts silent truncation into a checkable condition at both ends of the file.
3. **Source-link label compression.** Table-cell links become `[data/entities.ts](../../../node_modules/@open-mercato/core/src/modules/customers/data/entities.ts)` — label relative to the declared source root, href unchanged and still validated. Measured effect on `customers.md`: 218 KB → 180 KB (−17 %); `## Exact override targets` 62 KB → 51 KB, `## UMES hosts` 41 KB → 37.5 KB. Compression alone does **not** bound the largest sections under a 50 k-character read — that is what item 4 is for.
4. **Sub-anchors for oversized sections.** Any section whose rendered size exceeds ~32 KB is emitted with `###` subheadings along its natural grouping (for `## Exact override targets`, the existing Domain column; for `## UMES hosts`, the family column), and the Contents index lists those subsections with their own line anchors. This bounds every anchored read unit well under any known read cap, making sectioned reads sufficient rather than merely helpful.
5. **Guide reinforcement.** `agentic/guides/architecture.md` (already routed for module work) documents the Contents index, the end marker, and the sectioned-read procedure in two sentences. The root AGENTS.md sentence from PR #5267 stays as-is (byte budget, Q4).

Consequences: `module-facts.bc-guard.test.ts` link-exactness and byte-cap expectations updated (sizes shrink); `module-facts-build.test.ts` heading regexes unaffected (additive `## Contents` heading added to the fixed-order list); harness knowledge-change sha256 stamps refresh on rebuild as designed. Nothing in `cases.json`, `selectModuleFactSheets`, the injection block, ownership manifests, or the evaluator changes.

### Phase 2 — directory split with index (conditional)

Layout: `.ai/guides/modules/<id>/index.md` (header, staleness stamp, per-section file list with sizes and one-line descriptions) plus `<id>/<section-slug>.md` per non-empty section. Trigger: post-Phase-1 evidence (harness evaluations or session analyses like #5251) still showing truncation-driven or context-exhaustion failures.

The split is the more robust end state — plain file reads instead of offset reads, per-section addressability by path, index-first discovery — but it invalidates a pinned surface that must be migrated in one coordinated change:

- **Build:** `packages/create-app/build.mjs` and `packages/cli/build.mjs` (per-module `writeFileSync` → per-section tree; link relativity gains one `../`).
- **Setup mirrors:** `selectModuleFactSheets` + copy loop + ownership manifest in `packages/create-app/src/setup/tools/shared.ts`; the byte-identical CLI mirror in `packages/cli/src/lib/agentic-setup.ts`; the injected sentence pinned to `` `.ai/guides/modules/<id>.md` `` (root byte budget re-checked).
- **Tests:** `module-facts-build.test.ts`, `agents-md.module-guides.test.ts`, `agent-instruction-budget.test.ts`, `agent-surface-coverage.test.ts` (~30 literal paths + `reuseInstalledFacts`), `context-guidance-contracts.test.ts`, `agent-harness-evaluator.test.ts`, `agent-harness-knowledge-change.test.ts`, `module-facts.bc-guard.test.ts`, `TC-INT-008.spec.ts`.
- **Harness data:** 363 literal path references in `agentic/shared/ai/harness/cases.json` (mechanical rewrite, scripted); `evaluate-agent-harness.mjs` path special-cases; `validate-knowledge-change.mjs` (regex already subdirectory-tolerant).
- **Prose:** five skills/guides referencing the flat path; `architecture.md` directory diagram.
- **Migration:** `agentic:init --update-harness` must delete superseded flat `<id>.md` files via the ownership manifest (stale flat sheets shadowing fresh split ones would be worse than today's problem); one release of dual-emit (flat + split) is **not** proposed — the sheets are generated copies with a staleness stamp, and the knowledge-change validator already flags stale copies.

## Alternatives considered

- **Hint only (status quo after PR #5267).** Zero cost, but depends on the model noticing an unsignalled condition; the #5251 session demonstrates the failure.
- **Split without Phase 1's compression.** Two sections (`customers`/`sales` `## Exact override targets`, 62/57 KB) would still exceed a 50 k-character read on their own — a split alone does not reach "every read completes".
- **JSON sidecar as the primary agent interface.** `module-facts.v2.json` already exists and is machine-consumed (`framework-context.mjs`), but routed guidance, cases, and skills are built around markdown reading; retargeting them is a larger contract change than Phase 2 for less legibility.

## Implementation Breakdown

### Phase 1: sectioned reading affordances

- 1.1 Two-pass Contents index + end marker in `renderModuleFactsMarkdown` (+ reference projection variant), determinism-safe
- 1.2 Source-link label compression relative to `Source root` across all table renderers
- 1.3 `###` sub-anchors (with Contents entries) for sections rendering above ~32 KB
- 1.4 Update `module-facts.bc-guard.test.ts` (links, byte caps) and `module-facts-build.test.ts` (Contents heading, marker, sub-anchors)
- 1.5 `architecture.md` sectioned-read guidance; rebuild; harness evaluation run green

### Phase 2 (conditional): directory split

- 2.1 Generator + both build scripts emit `<id>/index.md` + section files
- 2.2 Setup tools + CLI mirror: selection, copy, manifest, injected sentence, root budget
- 2.3 Scripted `cases.json` path rewrite + evaluator/validator path handling
- 2.4 Test suite migration (files listed above); skills/guides prose
- 2.5 `agentic:init --update-harness` stale flat-file cleanup + upgrade note

## Migration & Backward Compatibility

Phase 1 is additive within the existing generated-file contract: paths, filenames, section headings, and href targets are unchanged; only link labels and two new blocks (Contents, end marker) differ, and the affected files are generated do-not-edit artifacts refreshed wholesale by `agentic:init --update-harness`. Phase 2 changes the generated-file layout — a contract surface under `BACKWARD_COMPATIBILITY.md` (generated files) — and therefore ships only with the cleanup step in 2.5, an `UPGRADE_NOTES.md` entry, and a coordinated release of `create-mercato-app` and `@open-mercato/cli`.

## Changelog

- 2026-08-14 — Implementation started for both phases; Phase 2's conditional trigger was explicitly overridden for the coordinated directory-layout migration.
- 2026-08-13 — Spec created from the PR #5267 follow-up analysis (split-vs-hint decision), with measured sheet/section sizes and the pinned-contract inventory.
