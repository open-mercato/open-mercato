# Standalone Harness Canonical List UI Enforcement

## Overview

- **Goal:** Bind OMH-185's canonical Books list acceptance to the required `backend/books/**` subtree so unrelated `DataTable` evidence cannot hide a raw list implementation.
- **Source doc:** `.ai/specs/2026-07-31-standalone-harness-canonical-list-ui-enforcement.md`
- **Origin:** Refs #4743 and #4670.
- **Affected area:** `packages/create-app` standalone harness oracle, its focused unit fixtures, and OMH-185 review/evidence documentation.

## Scope

- Prove the current aggregate-evidence false pass with a failure-first fixture.
- Reuse the existing safe TypeScript source collector to derive Books-list-subtree facts.
- Require exact canonical imports, stable `DataTable` host props, controlled search, existing add/edit/delete actions, and no raw table markup in that subtree.
- Preserve OMH-185, `module.table`, fixture, writable/review lane, timeout, and release-matrix identities.
- Synchronize focused tests and harness documentation, then run the complete configured and harness-specific verification gates.

## Non-goals

- Do not implement the sibling locale-catalog completeness spec.
- Do not change runtime `DataTable` or `RowActions` APIs.
- Do not repair any generated `visits` module or add a canonical example module.
- Do not renumber cases, widen writable paths, or weaken existing OMH-185 checks.

## Implementation Plan

### Phase 1: Prove the aggregate-evidence defect

1. Add the disconnected-valid-evidence/raw-list fixture.
2. Run it against the unchanged oracle and retain sanitized false-pass evidence.
3. Run a fresh OMH-185 Claude attempt when capacity is available and classify the result honestly.

### Phase 2: Bind the oracle to the required route

1. Add route-subtree source collection.
2. Strengthen `module.table` with imports, props, actions, and raw-tag rejection.
3. Add positive delegation and negative variant tests while keeping failures structured and sanitized.

### Phase 3: Synchronize and certify

1. Tighten OMH-185 and review documentation without adding a case ID.
2. Run focused, package, deterministic, related, mandatory, template-parity, and configured repository gates.
3. Run fresh writable target validation, generated review, and the full Claude release suite; publish only sanitized evidence.

## Risks

- The route scope could reject legitimate delegation. All nested source under `backend/books/**` remains eligible and receives a positive delegation fixture.
- Canonical import enforcement is intentionally strict and may reject barrels; diagnostics and negative fixtures make that contract explicit.
- Live Claude or Linux containment capacity can be unavailable. Such availability is reported as a blocker and never converted into passing evidence.
- The stricter oracle can lower OMH-185 runner pass rate; the check is not weakened to preserve historical pass rates.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Prove the aggregate-evidence defect

- [x] 1.1 Add the disconnected-valid-evidence/raw-list fixture. — 290039f68
- [x] 1.2 Run it against the unchanged oracle and retain sanitized false-pass evidence. — 290039f68
- [ ] 1.3 Run a fresh OMH-185 Claude attempt when capacity is available and classify the result honestly.

Failure-first evidence: the focused fixture reached `module.table` and observed the unchanged aggregate oracle returning a false pass; no raw model output or target path was retained.

### Phase 2: Bind the oracle to the required route

- [x] 2.1 Add route-subtree source collection. — 290039f68
- [x] 2.2 Strengthen `module.table` with imports, props, actions, and raw-tag rejection. — 290039f68
- [x] 2.3 Add positive delegation and negative variant tests while keeping failures structured and sanitized. — 290039f68

### Phase 3: Synchronize and certify

- [x] 3.1 Tighten OMH-185 and review documentation without adding a case ID. — 75c8418d9
- [ ] 3.2 Run focused, package, deterministic, related, mandatory, template-parity, and configured repository gates.
- [ ] 3.3 Run fresh writable target validation, generated review, and the full Claude release suite; publish only sanitized evidence.
