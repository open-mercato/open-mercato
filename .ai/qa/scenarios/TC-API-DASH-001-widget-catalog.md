# Test Scenario 122: Dashboard Widget Catalog API

## Test ID
TC-API-DASH-001

## Category
Dashboard & Widget APIs

## Priority
Low

## Type
API Test

## Description
Verify that the available dashboard widgets catalog can be retrieved.

## Prerequisites
- Valid authentication token
- User has dashboard permission
- Widgets are registered

## API Endpoint
`GET /api/dashboards/widgets/catalog`

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send GET request | Widget catalog returned |
| 2 | Verify widget list | All widgets present |
| 3 | Check widget metadata | Type, title, config schema |
| 4 | Filter by category | Category filter works |
| 5 | Check permissions | Only allowed widgets shown |

## Expected Response
```json
{
  "widgets": [
    {
      "id": "sales-summary",
      "type": "chart",
      "title": "Sales Summary",
      "description": "Overview of sales metrics",
      "category": "sales",
      "configSchema": {...},
      "requiredFeatures": ["sales.view"]
    }
  ],
  "total": 15
}
```

## Expected Results
- All available widgets listed
- Metadata includes configuration options
- Feature requirements shown
- Categories for organization
- Filtered by user permissions

## Edge Cases / Error Scenarios
- No widgets available (empty)
- Widget requires missing feature (filtered)
- Custom widgets (if supported)
- Widget deprecation
- Widget versioning
