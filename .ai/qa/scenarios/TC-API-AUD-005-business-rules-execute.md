# Test Scenario 97: Business Rules Execute (Dry-Run) API

## Test ID
TC-API-AUD-005

## Category
Audit & Business Rules APIs

## Priority
Medium

## Type
API Test

## Description
Verify that business rules can be executed in dry-run mode for testing.

## Prerequisites
- Valid authentication token
- Business rules are configured
- User has rules execution permission

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
  "mode": "dry-run"
}
```

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send POST with dry-run mode | Execution simulated |
| 2 | Verify response with results | What-if results |
| 3 | Check no actual changes | Data unchanged |
| 4 | Review matched rules | Rules that would fire |
| 5 | See planned actions | Actions without execution |

## Expected Response
```json
{
  "success": true,
  "mode": "dry-run",
  "matchedRules": [
    { "id": "rule-1", "name": "Auto Discount", "matched": true }
  ],
  "plannedActions": [
    { "type": "update_field", "field": "discount", "value": 10 }
  ],
  "actualChanges": null
}
```

## Expected Results
- Rules evaluated without side effects
- Matched rules identified
- Planned actions shown
- No data modifications
- Useful for testing rules

## Edge Cases / Error Scenarios
- Non-existent rule set (error)
- Invalid context (validation)
- Rule with external call (may skip or mock)
- Circular rule dependencies
- Rule execution timeout
