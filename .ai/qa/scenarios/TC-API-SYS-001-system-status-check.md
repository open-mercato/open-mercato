# Test Scenario 74: System Status API Check

## Test ID
TC-API-SYS-001

## Category
System & Maintenance APIs

## Priority
High

## Type
API Test

## Description
Verify that the system status API returns health information for all system components.

## Prerequisites
- Valid authentication token or API key
- User has `configs.manage` feature

## API Endpoint
`GET /api/configs/system-status`

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send GET request with auth token | Request accepted |
| 2 | Verify response status code | 200 OK |
| 3 | Validate response structure | JSON with status fields |
| 4 | Check database status | Connection info present |
| 5 | Check cache status | Redis status present |
| 6 | Check email status | Email service status |
| 7 | Check storage status | File storage status |

## Expected Response
```json
{
  "database": { "status": "healthy", "latency": 5 },
  "cache": { "status": "healthy", "type": "redis" },
  "email": { "status": "healthy", "provider": "smtp" },
  "storage": { "status": "healthy", "type": "local" },
  "overall": "healthy"
}
```

## Expected Results
- All components report status
- Latency metrics included where applicable
- Overall status reflects worst component
- Response time is reasonable (<1s)

## Edge Cases / Error Scenarios
- Call without auth (401 Unauthorized)
- Call without permission (403 Forbidden)
- Database down (status shows error)
- Cache unavailable (degraded status)
- Partial failures (mixed status)
