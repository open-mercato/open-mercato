# BUG-CAT-001: Category Create Allows Invalid "All Organizations" Context

## Summary
On `/backend/catalog/categories`, the organization selector can remain set to `All organizations`. From that state, user can open category creation and submit the form, which triggers a backend error instead of being prevented in UI.

## Severity
Major

## Area
Catalog / Categories / Organization Scope

## Reproducible Steps
1. Log in as user with catalog management permissions.
2. Go to `/backend/catalog/categories`.
3. In the header organization dropdown, select `All organizations` (empty value).
4. Open `/backend/catalog/categories/create` (via Create button or direct navigation).
5. Fill required field `Name`.
6. Click `Create`.

## Actual Result
- Submit sends `POST /api/catalog/categories`.
- Request fails because organization context is missing.
- User gets error after attempting valid-looking action.

## Expected Result
- User should not be able to submit create while context is `All organizations`.
- UI should enforce selecting a specific organization before submit.
- Create API should not be called from invalid global scope.

## Risk / Impact
- Regression-prone path in catalog CRUD.
- Confusing UX (action appears available but always fails).
- Increased support load from false-positive "form errors".

## Triage Classification
- Type: Product bug
- Regression test: `packages/core/src/modules/catalog/__integration__/TC-CAT-013.spec.ts`

