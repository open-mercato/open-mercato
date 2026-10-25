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

Merge prerequisite: merge design PR #7624 before this implementation. Its 2026-10-25 revision additionally proposes persisted-deal reclassification confirmation and tenant-wide authorization enforcement; those expanded API/command requirements need a separate implementation decision before declaring conformance to that revised design. This review remediation preserves the existing settings contract and addresses the concrete requests in review 5643620850.

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

Validation runner: local. All 20 focused suites / 179 tests passed, as did point-free TypeScript compilation (zero diagnostics), five lessons catalog tests and the client-boundary report (no new client root). The previous head's Linux CI passed; replacement-head CI must run after publication. Step 2.2 remains pending until current-head validation, revised-spec alignment and human QA/re-review are complete. Prior browser evidence and manual QA instructions remain linked on PR #7625; they do not grant QA approval.
