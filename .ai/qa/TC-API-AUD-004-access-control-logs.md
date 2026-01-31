# Test Scenario 96: Access Control Logs API

## Test ID
TC-API-AUD-004

## Category
Audit & Business Rules APIs

## Priority
Medium

## Type
API Test

## Description
Verify that access control events can be logged and retrieved.

## Prerequisites
- Valid authentication token
- User has security audit permission

## API Endpoint
- `GET /api/audit-logs/access` - Retrieve logs
- `POST /api/audit-logs/access` - Log event (internal)

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Trigger access event (login) | Event logged |
| 2 | Send GET request | Access logs returned |
| 3 | Filter by event type | Filtered results |
| 4 | Filter by user | User-specific logs |
| 5 | Filter by date range | Time-scoped results |

## Expected Response
```json
{
  "events": [
    {
      "id": "access-123",
      "type": "login_success",
      "userId": "user-1",
      "ip": "192.168.1.1",
      "timestamp": "2024-01-15T10:00:00Z",
      "details": { "method": "password" }
    }
  ],
  "total": 150
}
```

## Expected Results
- Login events captured
- Failed attempts logged
- IP addresses recorded
- Timestamps accurate
- Searchable/filterable

## Edge Cases / Error Scenarios
- High volume access logs
- Log retention period
- Sensitive IP masking
- Geo-location lookup
- Suspicious activity detection
