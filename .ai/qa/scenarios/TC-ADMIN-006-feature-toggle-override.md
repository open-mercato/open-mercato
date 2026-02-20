# Test Scenario 64: Override Feature Toggle per Tenant

## Test ID
TC-ADMIN-006

## Category
System Administration

## Priority
Medium

## Description
Verify that feature toggles can be overridden at tenant or organization level.

## Prerequisites
- User is logged in with `feature_toggles.manage` feature
- Global feature toggle exists
- Multiple tenants/organizations exist

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/backend/feature-toggles/overrides` | Overrides page displayed |
| 2 | Select a feature toggle | Toggle selected |
| 3 | Select target tenant/organization | Scope selected |
| 4 | Set override value | Different from global |
| 5 | Save override | Override is created |
| 6 | Verify override in list | Override appears |
| 7 | Test feature in overridden scope | Override applies |
| 8 | Test feature in non-overridden scope | Global applies |

## Expected Results
- Override record is created
- Override linked to toggle and scope
- Override takes precedence over global
- Non-overridden scopes use global
- Multiple overrides for different scopes
- Override can enable or disable
- Removing override reverts to global
- Override priority: User > Org > Tenant > Global

## Edge Cases / Error Scenarios
- Override for non-existent toggle (should prevent)
- Duplicate override for same scope (should update)
- Delete global toggle with overrides (cascade)
- Override for deleted tenant (should clean up)
- Conflicting overrides (priority resolution)
- Override cache synchronization
- Bulk override changes
- Override audit trail
