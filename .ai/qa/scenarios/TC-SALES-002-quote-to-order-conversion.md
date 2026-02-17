# Test Scenario 29: Convert Quote to Order

## Test ID
TC-SALES-002

## Category
Sales Management

## Priority
High

## Description
Verify that an approved quote can be converted to a sales order, preserving all line items and pricing.

## Prerequisites
- User is logged in with `sales.orders.create` feature
- A quote exists in appropriate status (e.g., "Approved")
- Customer has accepted the quote

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/backend/sales/quotes/[id]` | Quote detail is displayed |
| 2 | Verify quote is in convertible status | Status allows conversion |
| 3 | Click "Convert to Order" button | Conversion dialog/confirmation appears |
| 4 | Confirm the conversion | Conversion process starts |
| 5 | Observe conversion progress | Loading indicator shown |
| 6 | Verify order is created | Order detail page shown |
| 7 | Check order contains all quote lines | Lines match exactly |
| 8 | Verify pricing is preserved | Totals match quote |
| 9 | Check quote status is updated | Quote marked as "Converted" |

## Expected Results
- New order is created from quote data
- Order lines mirror quote lines exactly
- Pricing and discounts are preserved
- Customer and address snapshots are copied
- Quote is marked as converted
- Quote links to created order
- Order has new unique order number
- Order status is set (e.g., "Pending")
- Both documents reference each other

## Edge Cases / Error Scenarios
- Convert already converted quote (should be prevented)
- Convert expired quote (may warn or prevent)
- Product unavailable since quote creation (should handle)
- Price changes since quote (use snapshot price)
- Partial conversion (only some lines - if supported)
- Cancel conversion midway (rollback)
- Customer deleted since quote (should handle gracefully)
- Concurrent conversion attempts (prevent double-conversion)
