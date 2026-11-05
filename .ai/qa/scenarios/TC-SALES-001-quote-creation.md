# Test Scenario 28: Create Sales Quote

## Test ID
TC-SALES-001

## Category
Sales Management

## Priority
High

## Description
Verify that a user can create a sales quote with line items, customer assignment, and pricing calculations.

## Prerequisites
- User is logged in with `sales.quotes.create` feature
- Products exist in the catalog
- At least one customer exists
- Sales channel is configured

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/backend/sales/quotes` or sales documents | Quotes list is displayed |
| 2 | Click "Create Quote" button | Quote creation form is displayed |
| 3 | Select or search for customer | Customer is assigned to quote |
| 4 | Select sales channel | Channel determines pricing/tax rules |
| 5 | Add line item by searching product | Product is added to quote |
| 6 | Set quantity for line item | Quantity is updated |
| 7 | Verify unit price is populated | Price from catalog is shown |
| 8 | Add additional line items | Multiple lines are shown |
| 9 | Set validity period for quote | Start and expiration dates set |
| 10 | Click "Save" button | Quote is created |

## Expected Results
- POST request to `/api/sales/quotes` succeeds
- Quote record is created with unique number
- Quote lines are created with product snapshots
- Line totals are calculated (quantity × price)
- Quote totals are computed (net, tax, gross)
- Customer address is captured as snapshot
- Validity window is stored
- Quote status is set (e.g., "Draft")
- Quote appears in quotes list

## Edge Cases / Error Scenarios
- Quote without customer (may be allowed as draft)
- Quote without line items (may be allowed or prevented)
- Zero quantity line item (should be prevented)
- Negative quantity (should be prevented)
- Product not in selected channel (may filter or warn)
- Customer from different organization (should be filtered)
- Price changes after line added (snapshot vs. live price)
