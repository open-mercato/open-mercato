# Test Scenario 95: Audit Log Display API

## Test ID
TC-API-AUD-003

## Category
Audit & Business Rules APIs

## Priority
Low

## Type
API Test

## Description
Verify that formatted audit log entries can be retrieved for display.

## Prerequisites
- Valid authentication token
- Audit logs exist
- User has audit view permission

## API Endpoint
`GET /api/audit-logs/display`

## Query Parameters
- `entryId`: Specific log entry ID
- `format`: Display format (summary, full)

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send GET with entry ID | Entry details returned |
| 2 | Verify formatted output | Human-readable format |
| 3 | Check before/after values | Changes visible |
| 4 | Verify user information | Actor shown |
| 5 | Check timestamp format | Readable date |

## Expected Response
```json
{
  "id": "log-123",
  "action": "customers.company.update",
  "actor": { "id": "user-1", "name": "John Doe" },
  "timestamp": "2024-01-15T10:30:00Z",
  "summary": "Updated company 'Acme Corp'",
  "changes": [
    { "field": "name", "from": "Acme", "to": "Acme Corp" }
  ]
}
```

## Expected Results
- Entry is formatted for display
- Changes are highlighted
- Actor information included
- Timestamp is readable
- Links to related entities

## Edge Cases / Error Scenarios
- Non-existent entry (404)
- Entry for deleted entity (still shown)
- Sensitive data masking
- Very large change set
- Binary data changes
