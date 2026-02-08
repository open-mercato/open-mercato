# Test Scenario 103: Feature Toggle Check API

## Test ID
TC-API-FT-001

## Category
Feature Toggles APIs

## Priority
Medium

## Type
API Test

## Description
Verify that feature toggle status can be checked programmatically.

## Prerequisites
- Valid authentication token
- Feature toggles are configured

## API Endpoint
`POST /api/feature-toggles/check`

## Request Body
```json
{
  "features": ["new_dashboard", "beta_search", "ai_assistant"]
}
```

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send POST with feature names | Status returned |
| 2 | Verify boolean results | True/false per feature |
| 3 | Check with override context | Override applied |
| 4 | Test non-existent feature | Default false |
| 5 | Verify caching behavior | Consistent results |

## Expected Response
```json
{
  "features": {
    "new_dashboard": true,
    "beta_search": false,
    "ai_assistant": true
  },
  "context": {
    "tenantId": "tenant-123",
    "userId": "user-456"
  }
}
```

## Expected Results
- Feature states returned
- Context-aware evaluation
- Overrides applied correctly
- Non-existent = false
- Fast response time

## Edge Cases / Error Scenarios
- Empty feature list (empty response)
- Invalid feature name format
- User-specific override
- Tenant-level override
- Feature toggle disabled
