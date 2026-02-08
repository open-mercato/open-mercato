# Test Scenario 102: Dictionary Context API

## Test ID
TC-API-SEARCH-004

## Category
Search & Lookup APIs

## Priority
Low

## Type
API Test

## Description
Verify that localized dictionary context can be retrieved for forms.

## Prerequisites
- Valid authentication token
- Dictionaries are configured
- Localization is enabled

## API Endpoint
`GET /api/dictionaries/context`

## Query Parameters
- `dictionaryIds`: Comma-separated IDs
- `locale`: Target locale code

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send GET with dictionary IDs | Context returned |
| 2 | Verify entries are localized | Locale-specific labels |
| 3 | Check entry structure | Code and label pairs |
| 4 | Test different locale | Different translations |
| 5 | Test missing dictionary | Graceful handling |

## Expected Response
```json
{
  "dictionaries": {
    "customer_status": [
      { "code": "active", "label": "Active" },
      { "code": "inactive", "label": "Inactive" }
    ],
    "order_status": [
      { "code": "pending", "label": "Pending" },
      { "code": "completed", "label": "Completed" }
    ]
  },
  "locale": "en"
}
```

## Expected Results
- Dictionaries loaded
- Labels in requested locale
- Fallback to default locale
- Used for form dropdowns
- Cached for performance

## Edge Cases / Error Scenarios
- Non-existent dictionary (skip)
- Missing locale (fallback)
- Empty dictionary (empty array)
- Inactive entries (filtered)
- Very large dictionary
