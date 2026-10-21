# Tenant Deal Status Vocabulary

Implement issue #5546 using the existing module config service, preserving unconfigured behavior and historical aliases.

Source doc: .ai/specs/2026-10-18-deal-status-vocabulary.md
Spec PR: https://github.com/open-mercato/open-mercato/pull/7624

## Scope

Tenant/env/default vocabulary resolution, guarded settings API and editor, consistent list/aggregate/map/closure/AI/browser semantics, tests and operator docs. No migration, new dependency, or stage model redesign.

## Implementation Plan

1. Define schema, pure semantics and tenant-scoped resolver.
2. Add guarded settings command/API and editor.
3. Integrate server filters, closure/AI writes and related metrics.
4. Integrate browser consumers.
5. Add integration coverage and documentation.
6. Validate and independently review, publish evidence.

## Risks

Legacy status exports and existing no-configuration results remain compatible. Scope-sensitive client and server caches must not retain prior config. Validation runner: local (no running compose app). The checkout contains unrelated user changes, excluded from all task commits.

The full local gate is blocked by native Node/Jest worker SIGSEGV failures in unrelated search/UI tests, including retries in a clean checkout with supported Node 24 runtimes. Production app build, the first six ordered commands, all 341 affected customer suites (2373 tests), template parity and client boundaries passed. Current-head Linux CI still gates completion; do not mark step 2.2 complete from focused evidence alone.

## Progress

PR: #7625

> Convention: `- [ ]` pending, `- [x]` done. Append the implementation commit when a step lands.

### Phase 1: Configuration and consumers

- [x] 1.1 Define schema, pure semantics and resolver — c2001be897
- [x] 1.2 Add settings command/API and editor — c2001be897
- [x] 1.3 Integrate server filters and closure/AI writes — c2001be897
- [x] 1.4 Integrate browser consumers — c2001be897

### Phase 2: Verification

- [x] 2.1 Add integration coverage and operator documentation — c2001be897
- [ ] 2.2 Run validation, independent review and UI verification

Independent source review has no remaining confirmed findings. Browser state-matrix checks passed; evidence and manual QA instructions are attached to PR #7625. Resume at step 2.2 with `om-auto-continue-pr 7625` after resolving the full-gate runtime limitation or obtaining accepted complete CI evidence. Human QA remains required.
