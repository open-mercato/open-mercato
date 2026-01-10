# Test Scenario 79: Query Index Status API

## Test ID
TC-API-SYS-006

## Category
System & Maintenance APIs

## Priority
Medium

## Type
API Test

## Description
Verify that indexing job status can be retrieved.

## Prerequisites
- Valid authentication token
- User has appropriate permissions

## API Endpoint
`GET /api/query_index/status`

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send GET request | Status returned |
| 2 | Verify response structure | Coverage info present |
| 3 | Check entity type coverage | Percentage per type |
| 4 | Verify last indexed timestamps | Recent dates |
| 5 | Check for warnings | Missing coverage flagged |

## Expected Response
```json
{
  "coverage": {
    "catalog.product": { "indexed": 500, "total": 500, "percentage": 100 },
    "customers.company": { "indexed": 95, "total": 100, "percentage": 95 }
  },
  "lastFullReindex": "2024-01-15T10:00:00Z",
  "warnings": ["customers.company: 5% missing coverage"]
}
```

## Expected Results
- Coverage statistics are accurate
- All indexed types shown
- Warnings for incomplete coverage
- Timestamps are current
- Health indicators clear

## Edge Cases / Error Scenarios
- No entities indexed (empty status)
- Index corrupted (error state)
- Status during reindex (in-progress indicator)
- Stale index detection
- Per-organization status breakdown
