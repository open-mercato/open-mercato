# Test Scenario 119: Duplicate Key Constraint Errors

## Test ID
TC-API-ERR-003

## Category
API Error Handling & Edge Cases

## Priority
Medium

## Type
API Test

## Description
Verify that unique constraint violations return proper error responses.

## Prerequisites
- Entity with unique constraint (e.g., email)
- Existing record for duplicate test

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Create record with unique value | Success |
| 2 | Create duplicate record | Conflict error |
| 3 | Verify error structure | Clear message |
| 4 | Check field indicated | Violating field shown |
| 5 | Original record unchanged | No side effects |

## Expected Response
```json
{
  "error": "Conflict",
  "message": "Record with this value already exists",
  "statusCode": 409,
  "field": "email",
  "value": "duplicate@email.com"
}
```

## Expected Results
- 409 Conflict status
- Duplicate field identified
- Clear error message
- No partial creation
- Consistent handling

## Edge Cases / Error Scenarios
- Case-insensitive duplicates
- Compound unique constraints
- Soft-deleted record collision
- Race condition duplicates
- Multiple unique violations
