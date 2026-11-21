# Execution Plan: Row-Aware Search Authorization (#5183)

Source doc: .ai/specs/2026-11-21-row-aware-search-authorization.md
Spec PR: #10255
Issue: #5183

## Goal
Re-enable `messages:message`, `sales:sales_note`, and `sales:sales_document_address` in global/hybrid search and search AI tools with fail-closed row-aware authorization matching their module APIs, backed by additive `SearchEntityConfig.aclFeaturesMode?: 'all' | 'any'`, `SearchEntityConfig.filterResults`, backward-compatibility documentation, and unit + integration tests.

## Scope
- `@open-mercato/shared`: `SearchAclFeaturesMode`, `SearchEntityConfig.aclFeaturesMode`, `canReadSearchEntity()` `'any'` mode + fail-closed `filterResults` requirement.
- `@open-mercato/search`: unify `authorizeEntityAccess()` in `ai-tools.ts` onto `canReadSearchEntity()`, audit `viewer` propagation, update `global-search-acl.test.ts` drift guards, update `packages/search/AGENTS.md`, add unit tests and Playwright integration test `TC-SEARCH-019.spec.ts`.
- `@open-mercato/core`: implement `filterVisibleMessages` in `messages/search.ts` and `filterVisibleSalesNotes` / `filterVisibleSalesDocumentAddresses` in `sales/search.ts`, re-enable all three entities, add comprehensive unit tests.
- `BACKWARD_COMPATIBILITY.md`: document additive search extension contracts (`aclFeaturesMode`, `filterResults`, `SearchOptions.viewer`).

## Non-goals
- No platform-wide query-engine Record Scope Resolver (separate Enterprise roadmap).
- No DB schema or migration changes.
- No search strategy over-fetching changes.
- No new UI screens or components.

## Risks
- Post-`limit` filtering can return fewer than `limit` items when many hits are denied (matches existing `attachments:document_section` behavior).
- Any throw inside `filterResults` drops all hits for that entity (intentional fail-closed guarantee).
- Existing tenants with records created while entities were `enabled: false` need a reindex for historical records to appear.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Shared Polymorphic Entity-ACL Contract & Documentation

- [x] 1.1 Add `SearchAclFeaturesMode` / `aclFeaturesMode` and update `canReadSearchEntity()` — 4e330bea93
- [x] 1.2 Unify `authorizeEntityAccess()` in `search/ai-tools.ts` and audit `viewer` propagation — 4e330bea93
- [x] 1.3 Add entity-access and AI tool visibility-filter unit tests — 4e330bea93
- [x] 1.4 Document additive search contracts in `BACKWARD_COMPATIBILITY.md` and `packages/search/AGENTS.md` — 4e330bea93

### Phase 2: Row-Aware Visibility Filter for `messages:message`

- [x] 2.1 Implement and wire `filterVisibleMessages` in `messages/search.ts` — eca9eb28a6
- [x] 2.2 Add comprehensive `messages/search.ts` visibility unit tests — eca9eb28a6

### Phase 3: Row-Aware Visibility Filters for `sales:sales_note` and `sales:sales_document_address`

- [x] 3.1 Implement and wire `filterVisibleSalesNotes` and `filterVisibleSalesDocumentAddresses` in `sales/search.ts` — ae74c24dcc
- [x] 3.2 Add comprehensive `sales/search.ts` visibility unit tests — ae74c24dcc

### Phase 4: Re-Enable Entities, Update Drift Guards, and Ship Integration Coverage

- [x] 4.1 Re-enable `messages:message`, `sales:sales_note`, and `sales:sales_document_address` and update `global-search-acl.test.ts` — bd662bae5e
- [x] 4.2 Add self-contained Playwright integration test `TC-SEARCH-019.spec.ts` — bd662bae5e
