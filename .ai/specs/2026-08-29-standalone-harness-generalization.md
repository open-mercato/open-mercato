---
title: Standalone Harness Generalization for Unenumerated Business Modules
date: 2026-08-29
status: draft
---

# Standalone Harness Generalization for Unenumerated Business Modules

## TLDR

The standalone-app agent harness (routing knowledge, blueprints, fact sheets, and the evaluation catalog under `packages/create-app/agentic/`) is measurably tuned to an enumerated roster of built-in domains plus three novel-domain fixtures (`library`, `room_bookings`, `room_calendar_sync`). Agent work on a generic business module that nobody enumerated (a reporting module, a clinic booking module, an asset registry) falls off the enumerated paths at four layers: fact-sheet availability, blueprint row matching, the root keyword map, and decision-label scoring. This spec defines four remediation tracks that make the knowledge and grading layers domain-open without weakening any trusted oracle or security boundary.

## Problem Statement

Audit evidence (2026-08-29, measured against the shipped 234-case catalog):

1. **Fact-sheet monopoly.** Module fact sheets are generated only for `@open-mercato/*` packages (`packages/create-app/build.mjs`, `packages/cli/src/lib/generators/module-facts-discovery.ts`), and `assertPackageModuleFactsOnly` (`packages/cli/src/lib/generators/module-facts.ts`) throws on any app-local fact. `yarn generate` writes nothing under `.ai/guides/`. A user's own module in `src/modules/` therefore never has a fact sheet, while 163/234 cases (70%) lean on that asset class. The router hands a `customers` task a curated sheet, a blueprint row, and a keyword-map entry; it hands a user's `bookings` module nothing but raw source.
2. **Blueprint row matching with no miss handler.** The root router's `module-data` row makes loading `om-module-scaffold/references/business-one-shot-blueprints.md` and picking its "exact key" mandatory for every business one-shot. The file holds 42 rows (only 3 greenfield), instructs "Pick the closest row" and "Once a row matches, its route key is binding", and has no branch for a brief that matches no row. A generic brief is forced to impersonate the nearest CRM row.
3. **A published answer key inside shared knowledge.** 25.4% of the blueprint file (7,336 of 28,830 bytes, the "Complete Library Contract" section; 35.5% with "Canonical Staff Record Inference") is an ID-level and signature-level contract for exactly two catalog cases (OMH-185, OMH-193). `writable-ast-oracles.mjs` grades those same literals (`library:book`, `library.books.create`, `room_bookings.bookings.view`). Writable scores on 12 of 49 cases partly measure adherence to a published crib sheet rather than transferable module-building skill, and every unrelated business one-shot pays those bytes on every trigger.
4. **Closed keyword map.** The `Module-Specific Facts` map in `agentic/shared/AGENTS.md.template` enumerates 16 host domains with no default arm. "Booking", "report", "asset", "shift" resolve to nothing, so an agent either force-maps to a wrong built-in host or routes with no domain grounding.
5. **Decision-label scoring is an answer key that does not exist at runtime.** Only 19/234 cases declare a `decisionVocabulary`; for the other 215 the evaluator's prompt builder falls back to `decisionVocabulary ?? requiredDecisions`, handing the model the exact required labels with zero distractors. The label space holds 608 distinct labels, 403 of them (66%) used exactly once. The most-required label (`tenant-scope`, 24 cases) appears nowhere in `AGENTS.md.template` or any shipped skill. The dimension is inflated and untransferable.

The routing rules themselves (Axis 1 and Axis 2 tables, `om-data-model-design`, `src/modules/example`) are genuinely domain-neutral; the overfitting is concentrated in the knowledge and grading layers.

## Proposed Solution

Four tracks, independently landable, ordered by leverage over cost. Every change to a skill, blueprint, case, oracle, or router file is a knowledge-contract change and MUST follow the nine-step procedure in `packages/create-app/agentic/shared/ai/skills/om-evolve-harness/references/knowledge-change.md` (failure-first evidence, one smallest owner, synchronized counts, knowledge-change manifest validated with `yarn workspace create-mercato-app harness:validate-knowledge-change`).

### Track 1: no-match fallback in the blueprint and the keyword map

- Add an explicit "no matching row" branch to `business-one-shot-blueprints.md`: when no row's domain matches the brief, a new binding key (working name `generic-business-module`) applies. Its bounded context is the module-scaffold core procedure, `src/modules/example`, and the `om-data-model-design` route; impersonating the nearest domain row is explicitly forbidden.
- Add a default arm to the `Module-Specific Facts` keyword map in `AGENTS.md.template`: an unmatched domain noun means no installed host owns the domain; route `module-data` with the example reference and do not force-map to the nearest built-in.
- Root byte budget constraint: the generated root currently sits about 142 bytes under the 12 KiB target (`STANDALONE_ROOT_TARGET_BYTES`), so the default arm's bytes must be reclaimed elsewhere in the root or the shed-index fallback accepted deliberately (`packages/create-app/src/lib/agent-instruction-budget.test.ts` pins the choice). The change must land identically in `packages/create-app/template/AGENTS.md`; `root-instruction-parity.test.ts` enforces byte parity past the H1.
- Evaluations: add or extend routing cases whose prompts use unenumerated domain nouns and whose expected route is the generic branch. Failure-first: today these briefs route to the nearest enumerated row.

### Track 2: fact sheets for app-local modules

- Generate fact sheets for modules under `src/modules/` into a separate tree, `.ai/guides/app-modules/<id>/`, as a `yarn generate` post-step in the standalone app. Reuse `renderModuleFactsDirectory` and the app-local discovery path that already projects `example` into `.ai/guides/reference-modules/`. The separate tree preserves the `assertPackageModuleFactsOnly` invariant for published package output; no change to the package build.
- Router integration: extend the generated module-guides block with one pointer line for app-local sheets (same budget discipline as Track 1) and classify `.ai/guides/app-modules/` as progressive context in the evaluator's `isInitialContextPath` and in the budget test's mirror of that list.
- Staleness contract: sheets are regenerated by `yarn generate`; the standalone `AGENTS.md` guidance and `packages/create-app/agentic/shared/AGENTS.md.template` must state that, per the create-app rule that generator post-steps and standalone agent guidance stay aligned.
- Evaluations: a routing case whose correct context is the app-local sheet of a fixture app's own module, plus coverage that a writable fixture module's sheet exists after `yarn generate` in the prepared target.

### Track 3: move the library answer key into case-owned fixtures

- Relocate "Complete Library Contract" and "Canonical Staff Record Inference" (about 10.2 KB) from `business-one-shot-blueprints.md` into narrow reference files that only OMH-185 and OMH-193 declare in their case context. Every other business one-shot trigger drops those bytes; non-library work never reads library IDs. The two cases keep one smallest owner each (the relocated reference), and their oracles are untouched (oracles are case-scoped by design).
- Add one writable transfer case in a domain with no published contract anywhere in the knowledge layer, graded by a new case-scoped oracle, to measure genuine generalization instead of crib-sheet recall. This is a catalog addition and carries the full count-pin checklist: `cases.schema.json` (`minItems`/`maxItems` and ID patterns), `validators.json` (`expectedCaseCount`), the literals in `agent-surface-coverage.test.ts` and `agent-harness-evaluator.test.ts`, and the prose counts in `packages/create-app/README.md`, `ai/harness/README.md`, `ai/harness/RELEASE.md`, and `packages/create-app/AGENT-HARNESS.md`.

### Track 4: honest decision-label scoring

- Replace the `decisionVocabulary ?? requiredDecisions` fallback in the evaluator's prompt builder with deterministic distractor injection: the effective vocabulary is `requiredDecisions` plus distractors sampled from a family-level label pool derived from the catalog, seeded by case ID so prompts stay reproducible per catalog version. `validateCatalog` enforces that the effective vocabulary is at least twice the size of `requiredDecisions` (or that the case declares an explicit vocabulary meeting the same ratio).
- Add an advisory validator listing single-use labels to drive a later consolidation pass of the 608-label space toward a smaller canonical set; consolidation itself is out of scope here.
- This changes the assembled prompt for up to 215 cases, so Track 4 requires a full `yarn harness:release` re-certification, not only targeted case runs. `promptHash` (sha256 of the case's task prompt) is unaffected.

## Data and Contract Surfaces

- New files: `.ai/guides/app-modules/<id>/*.md` (generated, never hand-edited), relocated blueprint reference files under the harness fixture tree, new case and oracle entries for the transfer case.
- Modified knowledge owners: `business-one-shot-blueprints.md`, `agentic/shared/AGENTS.md.template` plus `template/AGENTS.md`, the generated module-guides block, `om-module-scaffold/SKILL.md` where it names the blueprint contract.
- Modified tooling: the standalone `yarn generate` pipeline (app-local sheet emission), `evaluate-agent-harness.mjs` (`isInitialContextPath`, vocabulary assembly, `validateCatalog` vocabulary ratio), `cases.schema.json`/`validators.json` for the new case.
- No product API routes, database schema, or UI surfaces change. No `BACKWARD_COMPATIBILITY.md` contract surface is touched; blueprint keys are harness-internal routing contracts governed by the knowledge-change procedure, and the retired direct-match keys keep a deprecation note in the blueprint for one release.

## Verification and Coverage

- Per track: failure-first evidence for every new or changed evaluation (the evaluation must fail against the pre-change knowledge owner and pass after), retained as sanitized summaries only.
- Deterministic gate after every track: `yarn harness:validate --all` from a fresh scaffold generated from the changed sources.
- Full release suite (`yarn harness:release`, Linux with Bubblewrap) after Track 3 (catalog count change) and Track 4 (prompt change); Tracks 1 and 2 need it only when their routing cases land.
- Unit coverage: `agent-instruction-budget.test.ts` (root budget and shed decision), `root-instruction-parity.test.ts` (both roots), `agent-surface-coverage.test.ts` and `agent-harness-evaluator.test.ts` (counts, vocabulary ratio validator, progressive-path classification), template sync tests for any `template/` mirror.
- No app API or UI paths are affected, so no new Playwright integration tests are required; harness lanes are the integration coverage for this change.

## Risks and Impact Review

- **Root budget overflow** (medium, standalone scaffolds): Tracks 1 and 2 both add root bytes against about 142 bytes of headroom. Mitigation: reclaim bytes in the same edit or accept the shed-index fallback deliberately; the budget test fails closed either way. Residual: a slightly terser root.
- **Score regression on certified lanes** (medium, release gate): Track 3 removes crib bytes and Track 4 removes the answer-key fallback, so measured pass rates on existing cases may drop, which is the honest baseline surfacing, not a regression. Mitigation: land each track behind its own release-suite run and record the before/after cohort in the refresh report. Residual: a re-baselined pass rate.
- **Distractor sampling instability** (low): a poorly seeded pool could make a case flaky across catalog versions. Mitigation: seed by case ID plus catalog hash, pin the pool derivation in `validateCatalog`, and keep the assembled vocabulary in the sanitized result for audit.
- **App-local sheet staleness** (low): a stale `.ai/guides/app-modules/` sheet could mislead routing. Mitigation: regenerate on every `yarn generate`, mark the tree generated-only, and have the router prefer source over a sheet whose module folder is missing.

## Out of Scope

- Consolidating the 608-label decision space (advisory validator only in Track 4).
- A second-model portability dimension in the release gate (same runner, different model); tracked separately.
- Skill-wide prompt-token reduction (blueprint splitting beyond Track 3, shared untrusted-content reference, `om-auto-*` override dedupe); candidates for a follow-up spec.
- The evaluator fixes already delivered on PR #5804 (matrix-declared timeout floors, composed-retry result caps, judge-lane floor, release `--reasoning-effort` pass-through, root parity test).

## Changelog

- 2026-08-29: Initial draft from the multi-model robustness and over-specificity audit.
