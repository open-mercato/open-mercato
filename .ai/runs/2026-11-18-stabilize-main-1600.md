# Stabilize main — afternoon run

## Goal

Repair current main CI failures and verify all 15 integration shards before requesting automerge.

## Scope

Main `f7f8e5ab1a5ddb8ace0803ff7ed2f6e2ba88cfa7` fails seven outbound attachment tests in `core-timezone` (run 44334863912). Investigate the routing fixture introduced before the new provenance checks, correct the root cause, and preserve attachment delivery assertions. Existing `stabilize/` and `ci-full` full-suite routing already meets the requested CI scope.

Branch: `stabilize/main-2026-11-18-1600`, from main. The unsuffixed branch belongs to already-merged #9789; use a fresh suffix to preserve its history. Its merged MikroORM repair resolves the earlier snapshot compiler failure.

Non-goals: production routing changes unless reproduction proves a runtime defect; changing workflow label triggers; weakening tenant/provenance checks; migrations, dependencies, releases, or merging into main.

## Implementation Plan

### Phase 1: Repair the confirmed regression

1.1 Reproduce the attachment failures and align fixtures with verified routing provenance.
1.2 Run focused routing and attachment tests in both default and Pacific/Auckland timezones.

### Phase 2: Verify and review

2.1 Run configured validation and full PR CI; resolve remaining genuine failures.
2.2 Dispatch the required final independent review, validate its report, and resolve findings.
2.3 Publish evidence, mark ready, and apply automerge only after current-head checks and workflows settle green.

## Risks

An incomplete fixture can return early and make attachment assertions meaningless; use real routing with coherent link, mapping, conversation and channel fixtures. Main may advance during this run, so record exact checked SHAs. No test failure or pending workflow counts as green. Runner: local unless the configured Docker probe finds a running app. GitHub full CI supplies the full integration environment.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Repair the confirmed regression

- [ ] 1.1 Reproduce the attachment failures and align fixtures with verified routing provenance.
- [ ] 1.2 Run focused routing and attachment tests in both default and Pacific/Auckland timezones.

### Phase 2: Verify and review

- [ ] 2.1 Run configured validation and full PR CI; resolve remaining genuine failures.
- [ ] 2.2 Dispatch the required final independent review, validate its report, and resolve findings.
- [ ] 2.3 Publish evidence, mark ready, and apply automerge only after current-head checks and workflows settle green.
