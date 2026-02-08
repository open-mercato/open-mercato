# Test Scenario 68: Cache Management

## Test ID
TC-ADMIN-010

## Category
System Administration

## Priority
Medium

## Description
Verify that cache can be viewed and cleared for system maintenance.

## Prerequisites
- User is logged in with `configs.manage` feature
- Cache management page is accessible
- Cache service (Redis) is operational

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/backend/config/cache` | Cache management displayed |
| 2 | View cache statistics | Usage stats shown |
| 3 | View cache keys/categories | Key patterns visible |
| 4 | Select specific cache category | Category selected |
| 5 | Click "Clear Cache" button | Confirmation dialog |
| 6 | Confirm cache clear | Cache is cleared |
| 7 | Observe success message | Clear confirmed |
| 8 | Verify cache is empty | Stats reflect clear |

## Expected Results
- Cache stats show memory usage
- Cache can be cleared globally
- Cache can be cleared by category
- Clear operation succeeds
- Application continues functioning
- Cache rebuilds on subsequent requests
- Clear is logged in audit trail
- No data loss from cache clear

## Edge Cases / Error Scenarios
- Cache service unavailable (error handling)
- Clear during high traffic (may cause spike)
- Selective key deletion (if supported)
- Cache clear on cluster (all nodes cleared)
- Clear specific user session cache
- Clear permission/ACL cache
- Clear search index cache (triggers reindex)
- Schedule cache clear (if supported)
