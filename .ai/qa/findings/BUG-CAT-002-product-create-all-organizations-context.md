# BUG-CAT-002: Product Create Allows Invalid "All Organizations" Context

## Summary
On `/backend/catalog/products`, the organization selector can stay on `All organizations`. In that state, user can open product creation and submit the form, which still sends create request instead of being blocked by UI.

## Severity
Major

## Area
Catalog / Products / Organization Scope

## Reproducible Steps
1. Log in as user with product management permissions.
2. Go to `/backend/catalog/products`.
3. In the header organization dropdown, select `All organizations` (empty value).
4. Open `/backend/catalog/products/create`.
5. Fill required fields (`Name`, `Description`, `SKU`).
6. Click `Create product`.

## Actual Result
- Submit sends `POST /api/catalog/products`.
- Flow runs in invalid global org scope.

## Expected Result
- User should not be able to submit product create while context is `All organizations`.
- UI should require selecting a specific organization first.
- `POST /api/catalog/products` should not be sent from global scope.

## Evidence
- Failing test: `packages/core/src/modules/catalog/__integration__/TC-CAT-019.spec.ts`
- Assertion failure: expected `productCreatePostCount` = `0`, got `1`
- Screenshot: `.ai/qa/tests/.ai/qa/test-results/artifacts/packages-core-src-modules--2351d--scope-is-All-organizations/test-failed-1.png`
- Error context: `.ai/qa/tests/.ai/qa/test-results/artifacts/packages-core-src-modules--2351d--scope-is-All-organizations/error-context.md`

## Triage Classification
- Type: Product bug
- Proposed owner: User/Product team
- Regression test: `packages/core/src/modules/catalog/__integration__/TC-CAT-019.spec.ts`

