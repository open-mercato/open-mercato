# Test Scenario 120: Rate Limiting Responses

## Test ID
TC-API-ERR-004

## Category
API Error Handling & Edge Cases

## Priority
Medium

## Type
API Test

## Description
Verify that rate limiting is enforced and returns proper responses.

## Prerequisites
- Rate limiting is configured
- Knowledge of rate limits

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Make requests within limit | All succeed |
| 2 | Exceed rate limit | 429 returned |
| 3 | Verify retry-after header | Wait time provided |
| 4 | Wait and retry | Request succeeds |
| 5 | Check rate limit headers | Limit info present |

## Expected Response
```json
{
  "error": "Too Many Requests",
  "message": "Rate limit exceeded",
  "statusCode": 429,
  "retryAfter": 60
}
```

## Headers
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1705323600
Retry-After: 60
```

## Expected Results
- 429 status when exceeded
- Retry-After header present
- Rate limit headers informative
- Limits reset on schedule
- Per-user or per-IP limiting

## Edge Cases / Error Scenarios
- API key vs user rate limits
- Endpoint-specific limits
- Burst allowance
- Distributed rate limiting
- Exempt endpoints (health)
