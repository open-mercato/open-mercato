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

Legacy status exports and existing no-configuration results remain compatible. Scope-sensitive client and server caches must not retain prior config. The tenant-wide settings authorization consequence is documented in the editor and operator guide.

The revised #7624 specification is included in this implementation branch. The user explicitly approved its reclassification confirmation/fingerprint and full-tenant authorization architecture on 2026-10-25. The approved guard is implemented in the existing atomic settings command and shared editor, including save/reset/undo, with additive request/409/header contracts. Risk is high because authorization and tenant-wide classification are affected; priority remains medium.

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

## Review remediation — 2026-10-25

Merged current `main`, preserving both compatibility-document additions. Addressed the exported callback helper bridge, company-only KPI display, dashboard vocabulary requests, case/Unicode classification, preferred closure stages, tenant-scope help, environment caching/diagnostics and per-field alias validation. Existing detail, Kanban, linking and dashboard helper consumers now forward the resolved vocabulary.

Validation runner: local. All 20 focused suites / 179 tests passed, as did point-free TypeScript compilation (zero diagnostics), five lessons catalog tests and the client-boundary report (no new client root). The previous head's Linux CI passed; replacement-head CI must run after publication. Step 2.2 remains pending until current-head validation and human QA/re-review are complete. Prior browser evidence and manual QA instructions remain linked on PR #7625; they do not grant QA approval.

## Approved persisted-deal guard — 2026-10-25

- [x] Require unrestricted per-feature tenant access before impact queries, including direct commands and replay.
- [x] Count only changed normalized aliases in non-deleted tenant deals under the existing configuration advisory lock; preserve stored statuses/outcomes.
- [x] Bind explicit confirmation fingerprints to tenant, actor, setting version, effective candidate and impacted status/count groups; recompute before save/reset/undo and preserve optimistic-lock precedence.
- [x] Add the shared confirmation dialog, cancel/keyboard handling and scope/version/candidate invalidation.
- [x] Add API/command/UI regression coverage and self-contained integration paths; update spec, OpenAPI and operator compatibility guidance.
- [ ] Validate the full guarded flow in the repository-managed disposable app and inspect current-head CI before marking verification complete.

Validation update: the final 22 focused suites passed 212 tests, including cancellation and scope-switch regressions. Core typechecking, generation, both 40-package builds, the production app build and locale synchronization passed. The standalone compatibility context-budget regression passed against committed LF sources after replacing this feature's repeated compatibility paragraph with a link to the complete upgrade guidance; no budget or harness rule changed.

The local disposable integration attempt reached all 10 discovered scenarios but failed at the first fixture login with `ECONNREFUSED` after the app became unreachable; nine scenarios did not run. Its automatic rebuild was stopped under the CI-first policy and only its owned runtime/database was cleaned up. This is an environment failure, not passing API/UI evidence. The guard-head CI core suites passed; its aggregate test job reported the now-corrected compatibility budget failure, and its integration job was still pending. Final-head CI, integration evidence, human review and `needs-qa` approval remain required.

Standalone harness audit: existing OMH-007/012/013/014/032/105/196/231 cases cover compatibility lookup, guarded commands, ACL, form conflicts, safe post-success behavior, deal customization and tenant settings. The new fingerprint/count schema is module-specific and documented through the generated customers route facts and exact installed source. No generic owner, evaluator, catalog, matrix or count change is needed. The dry-run audit records an evidence-only disposition; no certified harness lane or release pass is claimed.
