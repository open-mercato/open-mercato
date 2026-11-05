# Test Scenario 67: View System Status Dashboard

## Test ID
TC-ADMIN-009

## Category
System Administration

## Priority
High

## Description
Verify that the system status dashboard displays health information for all system components.

## Prerequisites
- User is logged in with `configs.manage` feature
- System status page is accessible
- All services are running for positive test

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/backend/config/system-status` | System status page displayed |
| 2 | View database status | Database connection status shown |
| 3 | View cache status | Cache (Redis) status shown |
| 4 | View email status | Email service status shown |
| 5 | View storage status | File storage status shown |
| 6 | View search index status | Search index health shown |
| 7 | Check for any errors | Error indicators visible |
| 8 | Refresh status | Status updates |

## Expected Results
- Dashboard shows all component statuses
- Healthy components show green/success
- Unhealthy components show red/error
- Status includes: Database, Cache, Email, Storage, Search
- Error details available on click
- Last check timestamp shown
- Auto-refresh or manual refresh available
- Links to detailed logs (if available)

## Edge Cases / Error Scenarios
- Database disconnected (error shown, app may be limited)
- Cache unavailable (warning, app continues)
- Email service down (warning, emails queued)
- Storage inaccessible (error for uploads)
- Partial service degradation (yellow/warning)
- Status check timeout (show timeout error)
- Permission to view vs fix issues
- Status history/trends (if available)
