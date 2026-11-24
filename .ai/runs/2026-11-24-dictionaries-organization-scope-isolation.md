# Execution Plan — Dictionaries Organization Scope Isolation

## Goal

Enforce strict selected-organization isolation across dictionaries read and write APIs so that within a single tenant, a session scoped to Organization B (`om_selected_org = orgB`) cannot list, read, or write entries into a dictionary owned by Organization A.

## Scope

- **Context resolution (`packages/core/src/modules/dictionaries/api/context.ts`)**:
  - Reject requests whose requested organization selection was rejected (`scope.selectionRejected === true`) with HTTP 403 instead of silently falling back.
  - Build `candidateIds` strictly from the active organization selection:
    - When `scope.selectedId` is set (concrete selected organization): use ONLY `[scope.selectedId]` so `readableOrganizationIds` resolves to that organization plus its `ancestorIds` (preserving downward inheritance while excluding sibling/unrelated organizations from `scope.allowedIds`, `auth.orgId`, and descendants from `scope.filterIds`).
    - When `scope.selectedId` is null and `Array.isArray(scope.filterIds)`: use `scope.filterIds` (restricted "All organizations" view).
    - When `scope.selectedId` is null and `scope.filterIds` is null: use `organizationId` when non-null (default single-org home fallback), or load all active tenant organizations when `organizationId` is null (unrestricted "All organizations" view).
- **Entry write routes (`packages/core/src/modules/dictionaries/api/[dictionaryId]/entries/route.ts`, `packages/core/src/modules/dictionaries/api/[dictionaryId]/entries/[entryId]/route.ts`)**:
  - Call `await loadDictionary(context, dictionaryId)` in `POST /api/dictionaries/[dictionaryId]/entries` before running mutation guards or dispatching `dictionaries.entries.create`, matching every other mutating dictionary route (returns 400 when organization context is missing and 404 when the dictionary does not belong to `context.organizationId`).
  - Use `context.tenantId` and `context.organizationId` (instead of `context.auth.tenantId` / `context.auth.orgId`) when reloading created/updated entries via `findOneWithDecryption`.
- **Entry commands defense-in-depth (`packages/core/src/modules/dictionaries/commands/entries.ts`)**:
  - Enforce active `ctx.selectedOrganizationId` (or `ctx.organizationScope?.selectedId`) and tenant scope when resolving the target dictionary in `resolveDictionaryForCreate` and entry in `resolveEntry`, returning 404 when the record belongs to another organization than the explicitly selected one.
- **Tests**:
  - Unit tests for `resolveDictionariesRouteContext` covering sibling org isolation, ancestor inheritance, parent-not-inheriting-child, rejected selection, empty scope, and "All organizations" modes.
  - Route and command unit tests covering cross-org read/write refusal (`GET /api/dictionaries`, `GET /api/dictionaries/[dictionaryId]`, `GET/POST /api/dictionaries/[dictionaryId]/entries`, and `dictionaries.entries.*` commands).
  - Self-contained Playwright API integration test (`TC-DICT-015-org-isolation.spec.ts`) reproducing the exact Org A / Org B scenario end-to-end.

## Non-goals

- Do not modify `packages/core/src/modules/customers/api/dictionaries/context.ts` (separate module; can be tracked as a follow-up).
- Do not modify global `resolveOrganizationScopeForRequest` in `directory`.
- Do not change database schemas, migrations, or UI components.

## Implementation Plan

### Phase 1: Enforce organization scoping in dictionaries context, entry routes, and commands

- **1.1** Restrict `resolveDictionariesRouteContext` readable organization scope to the active selection (plus ancestors) and reject invalid selections
- **1.2** Enforce selected-organization dictionary lookup on `POST /api/dictionaries/[dictionaryId]/entries` and align entry decryption scopes with active context
- **1.3** Enforce active selected-organization scoping in `dictionaries.entries` command resolvers as defense-in-depth

### Phase 2: Regression tests and validation

- **2.1** Add unit tests for `resolveDictionariesRouteContext` organization scope resolution and inheritance
- **2.2** Add route and command unit tests for cross-organization read/write isolation
- **2.3** Add self-contained Playwright API integration test covering Org A / Org B dictionary isolation

## Risks

- **Downward inheritance regression**: Child organizations must still inherit read-only dictionaries from their ancestor organizations (`organization.ancestorIds`). Covered explicitly in unit tests.
- **Unrestricted "All organizations" mode**: Superadmins selecting `__all__` (`scope.selectedId === null`, `scope.filterIds === null`, `organizationId === null`) must still list dictionaries across tenant organizations. Covered explicitly in unit tests.
- **Overlap with open PR #10522**: Open bot PR #10522 addresses issue #3845 by adding `await loadDictionary(context, dictionaryId)` to `entries/route.ts` only, without fixing `context.ts` or command-level selected-org enforcement. Using a distinct integration test filename (`TC-DICT-015-org-isolation.spec.ts`) avoids naming collisions while this PR closes both the read and write cross-org isolation defects together.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Enforce organization scoping in dictionaries context, entry routes, and commands

- [ ] 1.1 Restrict `resolveDictionariesRouteContext` readable organization scope to the active selection (plus ancestors) and reject invalid selections
- [ ] 1.2 Enforce selected-organization dictionary lookup on `POST /api/dictionaries/[dictionaryId]/entries` and align entry decryption scopes with active context
- [ ] 1.3 Enforce active selected-organization scoping in `dictionaries.entries` command resolvers as defense-in-depth

### Phase 2: Regression tests and validation

- [ ] 2.1 Add unit tests for `resolveDictionariesRouteContext` organization scope resolution and inheritance
- [ ] 2.2 Add route and command unit tests for cross-organization read/write isolation
- [ ] 2.3 Add self-contained Playwright API integration test covering Org A / Org B dictionary isolation
