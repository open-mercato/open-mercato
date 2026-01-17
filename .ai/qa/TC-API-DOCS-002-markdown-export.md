# Test Scenario 125: API Documentation Markdown Export

## Test ID
TC-API-DOCS-002

## Category
OpenAPI & Documentation APIs

## Priority
Low

## Type
API Test

## Description
Verify that API documentation can be exported as markdown.

## Prerequisites
- Documentation export enabled
- Documentation content exists

## API Endpoint
`GET /api/docs/markdown`

## Query Parameters
- `module`: Specific module (optional)
- `includeExamples`: Include code examples (optional)

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send GET request | Markdown returned |
| 2 | Verify markdown format | Valid markdown |
| 3 | Check section structure | Organized by module |
| 4 | Verify endpoint docs | Request/response shown |
| 5 | Check code examples | If requested |

## Expected Response
```markdown
# Open Mercato API Documentation

## Customers Module

### GET /api/customers/companies

Retrieves a list of companies.

#### Request

\`\`\`bash
curl -X GET https://api.example.com/api/customers/companies \
  -H "Authorization: Bearer <token>"
\`\`\`

#### Response

\`\`\`json
{
  "companies": [...],
  "total": 100
}
\`\`\`
```

## Expected Results
- Valid markdown output
- Sections organized logically
- Request examples included
- Response schemas shown
- Can be used for static docs

## Edge Cases / Error Scenarios
- Very large documentation
- Module not found
- No examples available
- Localized documentation
- Version-specific docs
