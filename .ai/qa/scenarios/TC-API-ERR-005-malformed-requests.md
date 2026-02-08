# Test Scenario 121: Malformed Request Handling

## Test ID
TC-API-ERR-005

## Category
API Error Handling & Edge Cases

## Priority
Medium

## Type
API Test

## Description
Verify that malformed requests are handled gracefully.

## Prerequisites
- API endpoint accepting JSON
- Various malformed payloads

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send invalid JSON | 400 Bad Request |
| 2 | Send wrong content-type | 415 or 400 |
| 3 | Send empty body | Validation error |
| 4 | Send oversized payload | 413 Payload Too Large |
| 5 | Send with wrong HTTP method | 405 Method Not Allowed |

## Expected Response (Invalid JSON)
```json
{
  "error": "Bad Request",
  "message": "Invalid JSON in request body",
  "statusCode": 400
}
```

## Expected Results
- Invalid JSON returns 400
- Clear error messages
- No server crash
- Proper content-type handling
- Method validation

## Edge Cases / Error Scenarios
- Partially valid JSON
- Unicode issues
- Binary data in JSON
- Very deep nesting
- Null byte injection
- Control characters
