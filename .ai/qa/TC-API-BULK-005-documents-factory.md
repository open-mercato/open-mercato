# Test Scenario 92: Documents Factory API

## Test ID
TC-API-BULK-005

## Category
Bulk Operations APIs

## Priority
Medium

## Type
API Test

## Description
Verify that sales documents can be created with automatic numbering via factory.

## Prerequisites
- Valid authentication token
- User has document creation permissions
- Numbering sequences configured

## API Endpoint
`POST /api/sales/documents/factory`

## Request Body
```json
{
  "documentType": "order",
  "customerId": "customer-123",
  "channelId": "channel-456",
  "lines": [
    {
      "productVariantId": "variant-789",
      "quantity": 2,
      "unitPrice": 99.99
    }
  ]
}
```

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send POST with document data | Document created |
| 2 | Verify auto-generated number | Sequential number |
| 3 | Check all calculations | Totals correct |
| 4 | Verify document in list | Appears correctly |

## Expected Response
```json
{
  "success": true,
  "documentId": "doc-123",
  "documentNumber": "ORD-2024-0042",
  "documentType": "order",
  "total": 199.98
}
```

## Expected Results
- Document created with unique number
- Sequence incremented
- All calculations done server-side
- Snapshots captured
- Factory encapsulates logic

## Edge Cases / Error Scenarios
- Invalid document type (error)
- Sequence exhausted (handle rollover)
- Concurrent creation (unique numbers)
- Missing required fields (validation)
- Invalid product reference (error)
