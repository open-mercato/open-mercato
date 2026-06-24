# All Organizations Encrypted Sort

## Overview

Goal: fix encrypted-column sorting when a user selects the "All organizations" scope, so rows from organization-scoped encryption maps are sorted by decrypted values instead of ciphertext or previous order.

Source issue: GitHub issue #3342, "All organizations scope ignores encrypted column sort".

## Scope

- Shared tenant data encryption service map lookup for all-organization query planning.
- Shared basic query engine encrypted sort phase.
- Core hybrid query index encrypted sort phase.
- Focused unit regression coverage for the service and both query engines.

## Non-Goals

- No API contract changes.
- No schema or migration changes.
- No UI/DataTable changes.
- No generated registry changes.

## Implementation Plan

### Phase 1: Encryption Map Planning

Teach encrypted-field detection to include organization-scoped maps when the current query scope is all organizations, while preserving exact/fallback map behavior for actual row encryption and decryption.

### Phase 2: Sort-Key Scope Projection

Make encrypted sort candidate queries retain `tenant_id` and `organization_id` when those columns exist, so each candidate row is decrypted with its own tenant/org encryption map before in-memory sorting.

### Phase 3: Regression Coverage

Add tests for all-organization encrypted sorting in the shared query engine and hybrid query index engine, plus service-level coverage for unioning organization-scoped encryption maps.

## Risks

- Encryption and tenant/org scoping are high-risk surfaces. The fix keeps SQL predicates tenant-scoped and does not widen the row result set; it only detects encrypted fields and carries scope columns into the internal sort-key projection.
- Raw SQL remains inside `TenantDataEncryptionService` because the service already bypasses ORM lifecycle hooks to avoid recursive decrypt loops and `packages/shared` cannot import core `EncryptionMap` entities.
- Full package typecheck/build is blocked locally until dependencies provide `tsc`.

## Validation

- `yarn.cmd workspace @open-mercato/shared test packages/shared/src/lib/encryption/__tests__/tenantDataEncryptionService.test.ts packages/shared/src/lib/query/__tests__/engine.test.ts`
- `yarn.cmd workspace @open-mercato/core test packages/core/src/modules/query_index/__tests__/hybrid-engine.test.ts`
- `git diff --check`

## Backward Compatibility

No public contract surface changes. Function signatures, API routes, database schema, generated files, event IDs, widget spot IDs, ACL IDs, DI names, and import paths are unchanged.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Encryption Map Planning

- [ ] 1.1 Include organization-scoped encrypted field maps for all-organization query planning

### Phase 2: Sort-Key Scope Projection

- [ ] 2.1 Retain tenant and organization scope columns during encrypted sort-key projection

### Phase 3: Regression Coverage

- [ ] 3.1 Add service, basic query engine, and hybrid query engine regression tests
