# Standalone harness session hardening

## Goal

Turn the reproducible failures from the July 31 standalone-app session into focused create-app template and agent-harness safeguards, so generated apps build and test consistently and agents fail closed on incomplete validation, unsafe public scope resolution, and raw transcript handling.

## Scope

- Make the standalone build script force Next.js production mode even when the development container exports `NODE_ENV=development`.
- Ship a shared standalone Jest setup for jest-dom, ResizeObserver, and common DOM methods, and transform MikroORM alongside Open Mercato packages.
- Ignore raw session exports in generated apps and state the safe transcript/baseline-diagnosis rules explicitly.
- Require the standalone implementation workflow to invoke code review and keep work incomplete when any configured validation command fails.
- Strengthen the public lead-capture blueprint and OMH-130 contract around explicit trusted target binding, scoped idempotency, and real route mapping.
- Add focused regression coverage for every changed template or guidance contract.

## Non-goals

- Do not modify the downloaded generated app or its database snapshot.
- Do not duplicate the entity-registry guidance, specification state-machine, locale completeness, or canonical list-UI work already landed or active elsewhere.
- Do not change database/API contracts, package dependency shape, or the scaffold mode.
- Do not replace OMH-130's synthetic writable oracle with a full persistence/integration oracle in this focused PR; record that broader certification work as follow-up.
- Do not redesign the special root `/` app-shell router without an explicit architecture decision.

## Implementation Plan

### Phase 1: Standalone template reliability

1. Force production mode in the generated build script and lock the behavior with a template contract test.
2. Add the shared Jest environment, MikroORM transformation, and raw-session ignore patterns with template contract tests.

### Phase 2: Harness enforcement

1. Make implementation completion, review, validation-exit handling, and baseline diagnosis fail closed and regression-tested.
2. Strengthen API-route and public lead-capture guidance plus OMH-130 decisions for explicit target binding and tenant/organization-scoped idempotency.

### Phase 3: Verification and delivery

1. Run focused create-app tests and the repository's full configured validation sequence with one recorded runner.
2. Run the authoritative PR review workflow, resolve actionable findings, finalize the PR metadata, and mark it ready.

## Risks

- Transforming more ESM dependencies in Jest can slow focused tests; keep the allowlist limited to packages demonstrated by the session.
- Global DOM shims can hide missing browser APIs; implement only stable no-op/test doubles that the shared UI needs and keep them guarded.
- Stronger harness wording without executable coverage can drift; pair each contract with source tests and leave the full behavioral oracle explicitly out of scope.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

PR: #4758

### Phase 1: Standalone template reliability

- [x] 1.1 Force production mode in the generated build script — 7faf316a4
- [x] 1.2 Add shared Jest setup, MikroORM transformation, and session-export hygiene — f3e0713ca

### Phase 2: Harness enforcement

- [x] 2.1 Fail closed on incomplete validation, missing review, and unsafe baseline diagnosis — 461eaba8b
- [x] 2.2 Enforce explicit public target binding and scoped lead idempotency contracts — 891c52c2d

### Phase 3: Verification and delivery

- [x] 3.1 Pass focused and full configured validation gates — 8e90b5073
- [x] 3.2 Complete authoritative PR review and delivery — 2ec3b1ada

### Phase 4: Business-language eval refinement

- [ ] 4.1 Generalize the OMH-130 user prompt while retaining autonomous safety decisions
- [ ] 4.2 Re-run focused and configured validation, then complete authoritative review
