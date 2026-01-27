# Test Scenario 63: Create Feature Toggle

## Test ID
TC-ADMIN-005

## Category
System Administration

## Priority
Medium

## Description
Verify that global feature toggles can be created for controlling feature availability.

## Prerequisites
- User is logged in with `feature_toggles.manage` feature
- Feature toggle management is accessible

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/backend/feature-toggles/global` | Toggles list displayed |
| 2 | Click "Create Toggle" button | Toggle form appears |
| 3 | Enter toggle name/key | Key accepted |
| 4 | Enter description | Description stored |
| 5 | Set default state (on/off) | State configured |
| 6 | Set toggle type (boolean, percentage) | Type selected |
| 7 | Save toggle | Toggle is created |
| 8 | Verify toggle in list | Toggle appears |

## Expected Results
- Feature toggle record is created
- Toggle has unique key
- Default state is applied globally
- Toggle can be checked in code
- Toggle affects feature availability
- Description documents purpose
- Toggle can be boolean or gradual rollout
- Toggle changes take effect immediately

## Edge Cases / Error Scenarios
- Duplicate toggle key (validation error)
- Empty toggle key (validation error)
- Invalid characters in key (may be restricted)
- Toggle without description (may be allowed)
- Toggle affecting critical features (requires caution)
- Toggle persistence across deployments
- Toggle caching (may need cache clear)
- Toggle used in code but not defined (fallback)
