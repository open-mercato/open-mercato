# Test Scenario 100: Vector Search Settings API

## Test ID
TC-API-SEARCH-002

## Category
Search & Lookup APIs

## Priority
Low

## Type
API Test

## Description
Verify that vector search settings can be configured.

## Prerequisites
- Valid authentication token
- User has vector configuration permission
- Vector search module enabled

## API Endpoint
- `GET /api/vector/settings` - Get settings
- `POST /api/vector/settings` - Update settings

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send GET request | Current settings |
| 2 | Verify settings structure | All options present |
| 3 | Update embedding model | POST with changes |
| 4 | Verify settings updated | New values reflected |
| 5 | Test search with new settings | Search works |

## Expected Response
```json
{
  "embeddingModel": "text-embedding-3-small",
  "dimensions": 1536,
  "defaultThreshold": 0.7,
  "maxResults": 100,
  "indexedEntityTypes": ["catalog.product", "customers.company"]
}
```

## Expected Results
- Settings retrievable
- Updates are persisted
- Valid model options
- Reindex may be required
- Settings affect search

## Edge Cases / Error Scenarios
- Invalid model name (error)
- Dimensions mismatch (reindex needed)
- API key not configured
- Settings during reindex
- Reset to defaults
