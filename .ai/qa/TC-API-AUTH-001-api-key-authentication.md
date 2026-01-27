# Test Scenario 111: API Key Authentication

## Test ID
TC-API-AUTH-001

## Category
API Authentication & Security

## Priority
High

## Type
API Test

## Description
Verify that API endpoints can be accessed using API keys.

## Prerequisites
- Valid API key exists
- Key has appropriate permissions

## API Headers
```
Authorization: Bearer api_key_xxxxx
```

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Make request with valid API key | Request authenticated |
| 2 | Verify response | Data returned |
| 3 | Make request with invalid key | 401 Unauthorized |
| 4 | Make request without key | 401 Unauthorized |
| 5 | Use key with limited scope | Scope enforced |

## Expected Results
- Valid key authenticates request
- Key permissions restrict access
- Invalid key is rejected
- Missing key returns 401
- Rate limiting applies

## Edge Cases / Error Scenarios
- Revoked API key (401)
- Expired API key (401)
- Key for different tenant
- Malformed key format
- Key with no permissions
- Concurrent requests with same key
- Key usage logging
