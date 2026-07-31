# Standalone Spec and Phase Gates

## Goal

Prevent large standalone-app requests from bypassing `om-spec-writing`, producing implementation-thin specifications, or collapsing dependent phases into one concurrent scaffolding pass. Generated harnesses should require an implementation-ready spec, preserve canonical backend UI primitives in the UI contract, and execute approved phases through explicit checkpoints.

## Scope

- Strengthen the standalone root instruction template and its `--agents none` fallback with a concise spec-readiness and phase-execution gate.
- Expand the standalone specification template so it captures requirement traceability, page-level interaction contracts, canonical Open Mercato primitives, integration coverage, dependency-ordered phases, and phase validation.
- Carry the stronger business/domain/architecture checks from the monorepo spec templates into the standalone template, and require cited native page references, semantic tokens, light/dark coverage, and explicit approval for custom UI exceptions.
- Tighten the local `om-implement-spec` phase reference and add a standalone `om-auto-implement-spec` override for no-remote fallback behavior.
- Add regression assertions to the create-app harness tests.

## Non-goals

- Do not repair the generated logotherapy application in `open-mercato-9`.
- Do not change the shared `open-mercato/skills` repository or repin its skill collection.
- Do not change create-app scaffold modes, runtime package dependencies, framework CRUD/UI APIs, or GitHub pipeline policy.

## Implementation Plan

### Phase 1: Specification readiness contract

1. Add an implementation-ready specification template covering open questions, reuse and boundaries, data/API/event contracts, page-level mockups and states, requirement traceability, integration coverage, and dependency-ordered phases.
2. Add concise generated-agent rules that require `om-spec-writing`, prevent implementation from a draft/incomplete spec, and require canonical `DataTable`/`CrudForm` choices to be explicit for backend pages.
3. Add regression assertions proving both generated instruction variants remain identical and retain the readiness contract.

### Phase 2: Phase-safe implementation routing

1. Strengthen the local phase-and-gates reference so only the current phase may enter implementation, blocked phases cannot run concurrently, and each phase closes with acceptance evidence plus the smallest validation gate.
2. Add a standalone `om-auto-implement-spec` override that audits spec readiness before invoking a PR engine and hands no-remote runs to local `om-implement-spec` instead of improvising a whole-spec parallel build.
3. Extend overlay tests to prove the override ships and the fallback/phase contracts remain present.

### Phase 3: Validation and publication

1. Run focused create-app harness tests and instruction-budget/sync checks, then the configured validation gate in local mode.
2. Review the final diff for compatibility, security, scope, and regression risks; publish the completed branch and PR with the required evidence.

## Risks

- The generated root instruction file has a strict byte budget. Keep the new gate concise and verify the budget rather than duplicating the full specification template there.
- Over-constraining small fixes would add unnecessary process. Apply the readiness gate only to new applications, multi-module/business-slice work, and other non-trivial spec-driven delivery.
- A no-remote fallback must preserve local productivity without pretending PR delivery occurred; route explicitly to `om-implement-spec` and report that PR publication is unavailable.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Specification readiness contract

- [x] 1.1 Add the implementation-ready spec template and generated-agent readiness gate — 29ea8a171
- [x] 1.2 Add regression coverage for the readiness contract and instruction parity — 4588a792e

### Phase 2: Phase-safe implementation routing

- [x] 2.1 Enforce sequential phase checkpoints in local spec implementation — 94b7c1f4d
- [x] 2.2 Add and test the standalone auto-implementation fallback contract — b9fcae8ad
- [x] 2.3 Align app-scale specs and UI delivery with monorepo/native design-system gates — 95bd83727

### Phase 3: Validation and publication

- [x] 3.1 Run focused and configured validation gates — 075f2f5a7
- [ ] 3.2 Complete automated review, PR evidence, and ready-for-review handoff
