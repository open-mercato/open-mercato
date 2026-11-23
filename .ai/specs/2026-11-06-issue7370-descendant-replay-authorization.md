# Issue #7370 — Descendant organization replay authorization

## TLDR

A parent-scoped administrator can undo their own staff-user creation in an authorized child while Parent remains selected. Undo and redo use the same organization membership rule. No auth or directory implementation changes are required.

## Overview and problem

The undo banner submits a valid token for an action logged under Child. Both the replay route and transaction guard compared that organization with the single selected Parent and returned 400. The request already has an authorized descendant-expanded scope. Related safeguards are documented in the protected-roles/audit-seam spec and the organization-scope fail-open hardening spec; those safeguards remain mandatory.

## Proposed solution and architecture

- The audit-local predicate checks the target against both the active organization filter and the authorized organization set through the existing shared access helper. Empty sets deny. When no finite set exists, retain the existing selected-organization/null/tenant-feature rule.
- Both replay routes use the predicate before latest-action lookup and dispatch. Latest-action lookups remain scoped to the target organization.
- The transaction guard resolves organization scope again with the existing directory resolver, the supplied transaction EntityManager, and uncached `loadAclWithEntityManager`. It therefore observes revoked grants and changed descendant membership. Current self/tenant feature checks and actor and tenant checks remain in place.
- Existing command-bus replay locks, token consumption, snapshot checks, and semantic inverse permissions remain owned by their existing implementations.

## Data models and API contracts

No schema, migration, dependency, request, response, route, feature identifier or generated-registry changes. The only new symbol is an audit-local authorization predicate. Tenant-level action logs with a null organization retain their existing behavior.

## Migration & Backward Compatibility

No migration is needed. Existing third-party handler capabilities and `authorizeAuditReplayWithEntityManager` parameters remain unchanged. The intentional correction is acceptance of a currently authorized descendant organization; a sibling outside the active authorized subtree remains unavailable, including to a caller with tenant replay permission and a concrete selection.

## Coverage

- Undo and redo route regressions: own Child with Parent selected; actor/tenant/sibling denial; consumed state and latest-action freshness; revoked transaction scope and features.
- Transaction helper tests use the real scope resolver: descendant success, sibling/tenant/actor/null denial, current tenant-feature semantics, revoked ACL and hierarchy, self-feature revocation, and null-organization logs.
- `TC-UNDO-7370-child-organization.spec.ts` covers POST undo/redo and GET user visibility with fresh parent/child/sibling, role, actor and target fixtures. It checks foreign actor denial, token reuse, new redo token, and revoked-scope denial without target mutation. Fixtures are cleaned in `finally`.
- UI rendering is unchanged. Manual QA: create a staff user in Child while Parent is selected; Undo should remove it without a selector change. Redo should restore it, and access revocation must prevent replay.

## Risks & Impact Review

Unauthorized sibling widening is the principal risk; both finite sets must authorize the row. Stale request authority is mitigated by exact-transaction uncached resolution and existing auth replay stabilization/locks. Existing legacy non-atomic commands retain their established transaction limitations. Live integration and UI results must be recorded separately from unit evidence; discovery alone is not execution.

## Final Compliance Report

Source changes are confined to audit replay. No authentication, directory, presentation, locale, governance, database, or external-module files change. Full gate and live-QA status are recorded in the PR validation section.

## Changelog

- 2026-11-06 — Implemented shared descendant-aware undo/redo authorization and current-transaction scope checks for #7370; added route/helper and API lifecycle regressions.
