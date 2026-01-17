# Test Scenario 76: Upgrade Actions API

## Test ID
TC-API-SYS-003

## Category
System & Maintenance APIs

## Priority
Medium

## Type
API Test

## Description
Verify that upgrade actions can be retrieved and executed via API.

## Prerequisites
- Valid authentication token
- User has `configs.manage` feature
- Upgrade actions are defined for version

## API Endpoint
- `GET /api/configs/upgrade-actions` - List actions
- `POST /api/configs/upgrade-actions` - Execute action

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send GET request to list actions | Actions list returned |
| 2 | Verify pending actions shown | Unexecuted actions listed |
| 3 | Select action to execute | Action identified |
| 4 | Send POST with action ID | Execution started |
| 5 | Verify action completes | Success response |
| 6 | Check action marked as run | No longer pending |

## Expected Response (GET)
```json
{
  "actions": [
    {
      "id": "seed-default-roles",
      "version": "1.0.0",
      "description": "Seed default roles",
      "status": "pending"
    }
  ]
}
```

## Expected Results
- Actions are listed with status
- Execute returns success
- Action is idempotent (can re-run)
- Action logs are created
- Tenant/org scoped execution

## Edge Cases / Error Scenarios
- Execute non-existent action (404)
- Execute already completed (no-op or error)
- Action execution fails (error logged)
- Concurrent execution (lock handling)
- Action timeout (long-running)
