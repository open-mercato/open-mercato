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

## Risks

- The existing example mixes reusable code with QA/demo breadth; progressive-disclosure entrypoints and capability-scoped links must keep agents from copying the whole tree.
- The two current trees already differ in 20 paths; baseline reconciliation must preserve the safer/correct behavior and cannot blindly copy the stale side.
- Disabling `example` changes the classic scaffold baseline; the spec must call this out as an intentional generated-app behavior change with explicit regression coverage.
- A mechanical rename could leave invalid `ReferenceTask` assumptions; the rewrite must use current `Todo`/`example` identifiers and name extensions only where the current tree lacks a surface.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Canonical reuse design

- [ ] 1.1 Rewrite the canonical spec around the existing example module
- [ ] 1.2 Define delivery, reference routing, and verification contracts
- [ ] 1.3 Define byte-identical monorepo/template example synchronization

### Phase 2: Companion alignment and review

- [ ] 2.1 Align the three companion specs with canonical example reuse
- [ ] 2.2 Complete consistency, compliance, and docs-only validation review
