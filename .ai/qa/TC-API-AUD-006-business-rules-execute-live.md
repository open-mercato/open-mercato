# Test Scenario 98: Business Rules Execute (Live) API

## Test ID
TC-API-AUD-006

## Category
Audit & Business Rules APIs

## Priority
Medium

## Type
API Test

## Description
Verify that business rules can be executed in live mode with actual changes.

## Prerequisites
- Valid authentication token
- Business rules are configured
- User has rules execution permission
- Test data for rule execution

## API Endpoint
`POST /api/business_rules/execute`

## Request Body
```json
{
  "ruleSetId": "ruleset-123",
  "context": {
    "entityType": "sales.order",
    "entityId": "order-456"
  },
  "mode": "live"
}
```

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send POST with live mode | Execution proceeds |
| 2 | Verify response | Success with changes |
| 3 | Check entity modified | Data actually changed |
| 4 | Review execution log | Actions recorded |
| 5 | Verify rule log entry | Log created |

## Expected Response
```json
{
  "success": true,
  "mode": "live",
  "matchedRules": [
    { "id": "rule-1", "name": "Auto Discount", "matched": true }
  ],
  "executedActions": [
    { "type": "update_field", "field": "discount", "value": 10, "success": true }
  ],
  "logId": "execution-log-789"
}
```

## Expected Results
- Rules evaluated and executed
- Data modifications applied
- Actions logged
- Execution log created
- Errors captured

## Edge Cases / Error Scenarios
- Rule action fails (partial execution)
- External service unavailable
- Infinite loop prevention
- Transaction rollback on error
- Concurrent rule execution
