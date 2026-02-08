# Test Scenario 101: Phone Number Lookup API

## Test ID
TC-API-SEARCH-003

## Category
Search & Lookup APIs

## Priority
Medium

## Type
API Test

## Description
Verify that customers can be looked up by phone number digits.

## Prerequisites
- Valid authentication token
- Customers exist with phone numbers

## API Endpoint
`GET /api/customers/people/check-phone`

## Query Parameters
- `digits`: Phone number to search
- `format`: Expected format (optional)

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send GET with phone digits | Search executed |
| 2 | Verify matching customer | Customer returned |
| 3 | Test partial number | Partial match |
| 4 | Test formatted number | Format handled |
| 5 | Test non-existent | Empty result |

## Expected Response
```json
{
  "found": true,
  "customer": {
    "id": "person-123",
    "name": "John Doe",
    "phone": "+1-555-123-4567"
  }
}
```

## Expected Results
- Phone lookup works
- Format-agnostic matching
- Partial digits supported
- Fast lookup performance
- Empty for no match

## Edge Cases / Error Scenarios
- Invalid phone format (normalization)
- Multiple matches (return first or all)
- International formats
- Extension numbers
- Recently deleted customer
