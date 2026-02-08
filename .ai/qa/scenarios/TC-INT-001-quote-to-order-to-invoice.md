# Test Scenario 69: End-to-End Quote to Order to Invoice to Payment

## Test ID
TC-INT-001

## Category
Integration Scenarios

## Priority
High

## Description
Verify the complete sales lifecycle from quote creation through payment collection, involving multiple modules.

## Prerequisites
- User is logged in with full sales permissions
- Customer exists with address
- Products exist in catalog with pricing
- Sales channel is configured
- Tax rates are configured

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Create a new sales quote | Quote form displayed |
| 2 | Select customer | Customer assigned |
| 3 | Add product line items | Lines added with pricing |
| 4 | Apply discount adjustment | Discount reduces total |
| 5 | Save quote | Quote created with number |
| 6 | Set quote to "Approved" status | Status updated |
| 7 | Convert quote to order | Order created from quote |
| 8 | Verify order has all quote data | Lines, customer, totals match |
| 9 | Record shipment for order | Shipment with tracking |
| 10 | Create invoice from order | Invoice generated |
| 11 | Verify invoice totals | Match order totals |
| 12 | Record payment against invoice | Payment captured |
| 13 | Verify invoice marked as paid | Status = Paid |
| 14 | Verify order status updated | Status reflects completion |

## Expected Results
- Quote → Order → Invoice → Payment flow completes
- All documents reference each other
- Totals are consistent across documents
- Customer receives correct documents
- Inventory is updated (if tracked)
- Revenue is recognized correctly
- Audit trail captures all actions
- Timeline shows complete journey

## Edge Cases / Error Scenarios
- Quote expires before conversion (warn or prevent)
- Product discontinued after quote (use snapshot)
- Partial payment (invoice partially paid)
- Payment refused (order remains unpaid)
- Customer changes address mid-process
- Tax rate changes between quote and invoice
- Currency fluctuation (if multi-currency)
- Concurrent modifications during flow
