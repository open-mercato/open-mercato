# Test Scenario 124: OpenAPI Specification API

## Test ID
TC-API-DOCS-001

## Category
OpenAPI & Documentation APIs

## Priority
Low

## Type
API Test

## Description
Verify that OpenAPI specification can be retrieved for API documentation.

## Prerequisites
- Documentation endpoint enabled
- OpenAPI spec is generated

## API Endpoint
`GET /api/docs/openapi`

## Query Parameters
- `format`: json or yaml (optional)
- `module`: Specific module (optional)

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send GET request | OpenAPI spec returned |
| 2 | Verify JSON format | Valid JSON |
| 3 | Check OpenAPI version | 3.x compliant |
| 4 | Verify paths documented | Endpoints listed |
| 5 | Check schema definitions | Models defined |

## Expected Response
```json
{
  "openapi": "3.0.3",
  "info": {
    "title": "Open Mercato API",
    "version": "1.0.0"
  },
  "paths": {
    "/api/customers/companies": {...},
    "/api/catalog/products": {...}
  },
  "components": {
    "schemas": {...},
    "securitySchemes": {...}
  }
}
```

## Expected Results
- Valid OpenAPI 3.x spec
- All public endpoints documented
- Request/response schemas
- Authentication documented
- Can be imported to Postman/Swagger

## Edge Cases / Error Scenarios
- YAML format request
- Module-specific spec
- Spec too large (pagination?)
- Internal-only endpoints excluded
- Deprecation markers
