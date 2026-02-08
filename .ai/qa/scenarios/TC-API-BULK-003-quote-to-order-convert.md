# Test Scenario 90: Quote to Order Conversion API

## Test ID
TC-API-BULK-003

## Category
Bulk Operations APIs

## Priority
High

## Type
API Test

## Description
Verify that quotes can be converted to orders via API.

## Prerequisites
- Valid authentication token
- User has `sales.orders.create` feature
- Quote exists in convertible status

## API Endpoint
`POST /api/sales/quotes/convert`

## Request Body
```json
{
  "quoteId": "quote-123",
  "options": {
    "copyAdjustments": true,
    "copyNotes": true
  }
}
```

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Verify quote is convertible | Status check |
| 2 | Send POST to convert | Conversion starts |
| 3 | Verify response with order ID | New order returned |
| 4 | Check order matches quote | Lines, totals match |
| 5 | Verify quote status updated | Marked as converted |
| 6 | Check cross-reference | Documents link each other |

## Expected Response
```json
{
  "success": true,
  "orderId": "order-456",
  "orderNumber": "ORD-2024-0001",
  "quoteId": "quote-123",
  "quoteStatus": "converted"
}
```

## Expected Results
- Order created from quote
- All lines transferred
- Pricing preserved
- Customer info copied
- Documents linked
- Quote cannot be re-converted

## Edge Cases / Error Scenarios
- Already converted quote (error)
- Expired quote (warning or prevent)
- Product unavailable (handle gracefully)
- Customer deleted (use snapshot)
- Partial conversion (if supported)
