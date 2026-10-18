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

## Progress

### Phase 1: Configuration and consumers

- [ ] 1.1 Define schema, pure semantics and resolver
- [ ] 1.2 Add settings command/API and editor
- [ ] 1.3 Integrate server filters and closure/AI writes
- [ ] 1.4 Integrate browser consumers

### Phase 2: Verification

- [ ] 2.1 Add integration coverage and operator documentation
- [ ] 2.2 Run validation, independent review and UI verification
