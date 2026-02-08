# Test Scenario 117: Zod Validation Error Responses

## Test ID
TC-API-ERR-001

## Category
API Error Handling & Edge Cases

## Priority
High

## Type
API Test

## Description
Verify that validation errors return proper structured responses.

## Prerequisites
- API endpoint with Zod validation
- Knowledge of validation rules

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send request with missing required field | Validation error |
| 2 | Verify error structure | Field-level errors |
| 3 | Send request with invalid type | Type error |
| 4 | Send request with invalid format | Format error |
| 5 | Send multiple errors | All errors listed |

## Expected Response
```json
{
  "error": "Validation Error",
  "message": "Request validation failed",
  "statusCode": 400,
  "details": [
    {
      "field": "email",
      "message": "Invalid email format",
      "code": "invalid_string"
    },
    {
      "field": "name",
      "message": "Required",
      "code": "required"
    }
  ]
}
```

## Expected Results
- 400 Bad Request status
- Field-level error details
- Clear error messages
- Multiple errors returned
- Consistent format

## Edge Cases / Error Scenarios
- Nested object validation
- Array item validation
- Custom validation messages
- Union type errors
- Refinement errors
