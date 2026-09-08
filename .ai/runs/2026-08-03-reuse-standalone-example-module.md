# Reuse the Standalone Example Module

## Overview

Goal: revise the standalone reference-module design so generated apps ship the existing `src/modules/example` source disabled by default, agents use that code as their canonical reference, and missing reference surfaces extend `example` instead of creating a duplicate module.

Source docs:

- `.ai/specs/2026-07-31-standalone-canonical-example-module.md`
- `.ai/specs/2026-08-01-standalone-harness-knowledge-governance.md`
- `.ai/specs/2026-08-01-standalone-harness-example-read-policy.md`
- `.ai/specs/2026-08-01-standalone-agent-spec-first-routing.md`

## Scope

- Replace the proposed `reference_module` architecture with reuse of the existing create-app template `example` module.
- Specify source-presence and registration-absence contracts for every built-in preset.
- Inventory existing example coverage and describe additive extensions only for genuinely missing surfaces.
- Reconcile `apps/mercato/src/modules/example/**` as the authoring source and require a byte-identical create-app template mirror with deterministic drift enforcement.
- Point standalone skills and harness cases at exact files under `src/modules/example` through the bounded example-read policy.
- Preserve the implementation-topic coverage formerly carried by embedded harness snippets with visible, exact links from every emitted knowledge owner to local example or installed package source.
- Make the canonical Todo DataTable demonstrate a long-running bulk action that reports platform operation progress in the top bar.
- Require self-contained integration coverage for every new example extension surface.
- Reconcile PR #4883's generated extension topology and module-fact conventions against the canonical example, adding representative executable coverage or exact specialist-source routing for every kind.
- Link the standalone harness and canonical example UI inventory to PR #4301's living design-system gallery, exact packed gallery/UI sources, and preset-aware gallery deep links without coupling the modules.
- Keep the packed `design_system` gallery source available to the harness while automatically omitting its module registration and runtime surface from every newly generated standalone app.
- Attach PR #4277 token/Figma/Code Connect provenance and honest mapping status to every standalone harness design-system item, with exact local/packed sources where available.
- Keep the four related specs consistent, implementation-ready, and explicit about validation and compatibility.

## Non-goals

- Implement template, preset, harness, or example-module code changes.
- Enable the example module in generated applications.
- Redesign unrelated harness policy or alter public framework contracts.
- Change the `ratelimit_probe` fixture or the `example_customers_sync` delivery policy.

## Implementation Plan

### Phase 1: Canonical reuse design

1. Rewrite the canonical example-module spec around the existing `example` tree, its current reusable surfaces, and additive gap extensions.
2. Define disabled-by-default delivery, exact reference paths, harness selection, and preset/activation verification without a shadow module.
3. Define the one-owner synchronization workflow and baseline reconciliation for the monorepo/template example trees.

### Phase 2: Companion alignment and review

1. Align governance, example-read, and spec-first routing specs with the canonical `src/modules/example` contract.
2. Run link/terminology checks, adversarial spec review, final compliance review, and the docs-only validation gate.

### Phase 3: Whole-harness source-link parity

1. Inventory the complete emitted harness and map every implementation-bearing example from the `main` baseline to one retained normative snippet or one visible exact source link.
2. Define deterministic local-example and installed-package link resolution, ownership, drift, and fresh-scaffold validation contracts.
3. Require the canonical Todo DataTable bulk action to create a real progress job and drive the platform top progress bar, with integration coverage for every newly added extension surface.

### Phase 4: PR #4883 extension-topology coverage

1. Inventory every public contribution, activation, host, capability, specialized-registry, target, and resolution kind introduced by PR #4883.
2. Map each executable source convention to current canonical-example code, fact readability, an additive example gap, or an exact specialist installed-source route.
3. Extend the canonical and companion specs with fact-readable exports, generated-topology assertions, and self-contained integration coverage for each new executable example surface.
4. Re-run consistency, adversarial review, documentation validation, and the PR publication gates.

### Phase 5: PR #4301 design-system reference coverage

1. Audit PR #4301's final gallery registry, entry, public-import, token, route, ACL, and QA contracts.
2. Map canonical example UI sources to exact gallery entries and separately declared public UI implementation sources, with preset-aware live-route metadata.
3. Extend standalone routing, read-policy, governance, source-link inventory, and evaluator requirements without copying gallery rules, snippets, lists, or allowlists; make all built-in fresh presets `source-only` by removing the `design_system` registration and covering a separate activation fixture.
4. Re-run cross-spec consistency, link/terminology checks, independent review, and publication validation.

### Phase 6: PR #4277 design-foundation reference coverage

1. Audit PR #4277 token snapshot/exporter, Figma Variables, Code Connect, and opt-in design-skill contracts, including emitted/packed availability.
2. Classify every PR #4301-derived standalone harness design-system item for token and Code Connect applicability, with explicit mapped/unmapped/placeholder/not-applicable status rather than fabricated coverage.
3. Extend routing, read-policy, governance, generated token-reference ownership, and validation while keeping Figma credentials/network/manual publishing outside normal harness execution.
4. Re-run cross-spec consistency, independent review, documentation checks, and publication validation.

## Risks

- The existing example mixes reusable code with QA/demo breadth; progressive-disclosure entrypoints and capability-scoped links must keep agents from copying the whole tree.
- The two current trees already differ in 20 paths; baseline reconciliation must preserve the safer/correct behavior and cannot blindly copy the stale side.
- Disabling `example` changes the classic scaffold baseline; the spec must call this out as an intentional generated-app behavior change with explicit regression coverage.
- A mechanical rename could leave invalid `ReferenceTask` assumptions; the rewrite must use current `Todo`/`example` identifiers and name extensions only where the current tree lacks a surface.
- PR #4301 merged as `bf25803d7a8c85c8552db9e76c7cc4398d1768be`; certification must verify that merged/package baseline and actual preset module availability rather than relying only on provenance head `186af58044c7530885a889c41f53bb36a5093d82`.
- PR #4277 remains open at audited head `fb9b8ddfe4470ef11d312caa4628c46af7d48adf`; provenance may be specified now, but readable/emitted/packed foundation references cannot certify until a final merged baseline and artifact availability are verified.

## Progress

PR: #4878

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Canonical reuse design

- [x] 1.1 Rewrite the canonical spec around the existing example module — 4ba460af1
- [x] 1.2 Define delivery, reference routing, and verification contracts — 4ba460af1
- [x] 1.3 Define byte-identical monorepo/template example synchronization — 4ba460af1

### Phase 2: Companion alignment and review

- [x] 2.1 Align the three companion specs with canonical example reuse — 4ba460af1
- [x] 2.2 Complete consistency, compliance, and docs-only validation review — 4ba460af1
- [x] Post-review fix: separate inventory coverage kind from QA-only reference status — e91e24e3e

### Phase 3: Whole-harness source-link parity

- [x] 3.1 Inventory prior-main snippets and all emitted harness knowledge owners — b42b1755d, 3d0ff4c0d
- [x] 3.2 Define visible direct-link and installed-source resolution contracts — b42b1755d
- [x] 3.3 Specify DataTable bulk-operation progress and extension integration coverage — b42b1755d, 3d0ff4c0d
- [x] 3.4 Complete independent review and docs-only validation — 3d0ff4c0d

### Phase 4: PR #4883 extension-topology coverage

- [x] 4.1 Inventory PR #4883 extension and module-fact taxonomies — 8b39a5cc9
- [x] 4.2 Classify canonical-example fact coverage and exact specialist routes — 8b39a5cc9
- [x] 4.3 Specify fact-readable additions and integration/generator proofs — 8b39a5cc9
- [x] 4.4 Complete independent review and publication validation — 8b39a5cc9

### Phase 5: PR #4301 design-system reference coverage

- [x] 5.1 Audit PR #4301 gallery and packed-source contracts — 8b39a5cc9
- [x] 5.2 Map canonical example UI uses to gallery and UI implementation sources — 8b39a5cc9
- [x] 5.3 Specify harness routing, read, governance, and verification contracts — 8b39a5cc9
- [x] 5.4 Complete independent review and publication validation — 8b39a5cc9

### Phase 6: PR #4277 design-foundation reference coverage

- [x] 6.1 Audit PR #4277 design-foundation contracts and artifact availability — 8b39a5cc9
- [x] 6.2 Classify every standalone design-system item for token and Code Connect applicability — 8b39a5cc9
- [x] 6.3 Specify harness routing, read, governance, and verification contracts — 8b39a5cc9
- [x] 6.4 Complete independent review and publication validation — 8b39a5cc9

## Validation Evidence

- Local runner selected because Docker is unavailable in the WSL environment.
- Passed: `yarn build:packages`, `yarn generate`, second `yarn build:packages`, `yarn i18n:check-sync`, `yarn i18n:check-usage` (advisory unused-key report only), `yarn typecheck`, `yarn build:app`, `yarn agents:check-budget`, `git diff --check`, terminology checks, and local Markdown-link resolution.
- The first `yarn test` run exposed an unrelated timing flake in `agent-harness-evaluator.test.ts`; its exact test passed immediately on rerun.
- The full `yarn test` rerun exposed pre-existing `backendChrome.current-organization.test.ts` expectations that omit the runtime's `preserveAspectRatio: false`; the exact test reproduces independently of this Markdown-only diff.
- `yarn template:sync` intentionally reports the existing 29-file repository/template baseline drift, including the `example` differences this design requires the implementation phase to reconcile. No sync fix was applied in this specs-only run.
- Phase 3 passed two independent adversarial re-reviews after fixes: direct-link/baseline/bulk durability and cross-spec read-policy/integration consistency reported no remaining blockers.
- Phase 3 passed local Markdown-link resolution, `git diff --check`, and direct `node scripts/check-agents-md-budget.mjs`; the budget script reported only existing ratcheted nested-chain overages and confirmed the root instruction remains within its configured limit.
- A pinned-baseline verifier loaded the eight exact assets from `f7c941570003f3abe920b1765995cbef98dcad0b`, matched every recorded SHA-256, and confirmed the per-asset CommonMark fence counts sum to 136.
- PR #4883 was audited at review input `092e56572c8dc5a22c5a53e913862fd8324cc842`; the specs preserve normal package fact-output semantics, define a separate local-example reference projection, and cover the closed extension/topology/diagnostic sets with exact-source and integration proof.
- PR #4301 was audited at provenance head `186af58044c7530885a889c41f53bb36a5093d82` and merged/package baseline `bf25803d7a8c85c8552db9e76c7cc4398d1768be`; the specs map example UI to direct or honest composite-constituent gallery sources and require `design_system` to remain unregistered/source-only in every fresh preset.
- PR #4277 was audited at open, changes-requested, conflicting head `fb9b8ddfe4470ef11d312caa4628c46af7d48adf`; pack inspection found Code Connect sources physically present only as non-exported auxiliary files, while the token snapshot and opt-in design skill are not emitted to standalone apps. The spec records these as provisional applicability/status rather than certified live or published mappings.
- Independent scope, taxonomy, and cross-spec reviews verified the Phase 4–6 boundaries. The final cross-spec pass reported no remaining specification blocker after the exact Code Connect exception, CSS/snapshot authority split, unavailable-skill semantics, and packed-auxiliary/export facets were aligned.
- Dependencies were installed immutably in the isolated continuation worktree. The configured local validation sequence completed before publication: every build, generation, i18n, and typecheck gate passed; `yarn test` reached 1,141 passing core suites and reproduced only the unrelated two-expectation `backendChrome.current-organization.test.ts` baseline mismatch described above.
