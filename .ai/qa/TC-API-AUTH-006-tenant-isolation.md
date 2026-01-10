# Test Scenario 116: Tenant Data Isolation

## Test ID
TC-API-AUTH-006

## Category
API Authentication & Security

## Priority
Critical

## Type
API Test

## Description
Verify that tenant data isolation is properly enforced across all API endpoints.

## Prerequisites
- Multiple tenants exist
- Users in different tenants
- Data exists in both tenants

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Authenticate as Tenant A user | Token for Tenant A |
| 2 | Request Tenant A data | Data returned |
| 3 | Request Tenant B data by ID | 404 or empty |
| 4 | Attempt cross-tenant query | Filtered out |
| 5 | Create record in Tenant A | Scoped to Tenant A |
| 6 | Verify Tenant B cannot see | Isolation confirmed |

## Expected Results
- User only sees own tenant data
- Cross-tenant IDs return 404
- Queries filter by tenant
- New records scoped correctly
- No data leakage

## Edge Cases / Error Scenarios
- Super admin cross-tenant access (if allowed)
- Organization within tenant
- Shared reference data (dictionaries)
- Tenant ID in URL vs body
- Bulk operations cross-tenant
- Import/export isolation
