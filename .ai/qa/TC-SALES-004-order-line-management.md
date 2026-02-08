# Test Scenario 31: Manage Order Lines

## Test ID
TC-SALES-004

## Category
Sales Management

## Priority
High

## Description
Verify that order lines can be added, edited, and removed from an order, with totals recalculating appropriately.

## Prerequisites
- User is logged in with `sales.orders.edit` feature
- An editable order exists (status allows editing)
- Products exist in catalog

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to order detail page | Order with lines is displayed |
| 2 | Click "Add Line" button | Product search/selection appears |
| 3 | Search and select a product | Product is added as new line |
| 4 | Set quantity | Line total updates |
| 5 | Edit existing line quantity | Total recalculates |
| 6 | Change unit price (if allowed) | Custom price is set |
| 7 | Remove a line item | Line is deleted |
| 8 | Verify order totals update | Net, tax, gross recalculated |
| 9 | Save changes | Order is updated |

## Expected Results
- Lines can be added from product catalog
- Quantity changes trigger recalculation
- Unit price can be overridden (if permitted)
- Line total = quantity × unit price
- Removing line updates order total
- Minimum order requirements enforced (if any)
- Line item notes can be added
- Product variants are properly handled
- Order total reflects all line changes

## Edge Cases / Error Scenarios
- Add line to shipped order (may be prevented)
- Zero quantity (should remove line or error)
- Negative quantity for returns (may be separate flow)
- Change quantity to very large number (validation)
- Remove all lines (order becomes empty - may warn)
- Add same product twice (combine or separate lines)
- Price override below cost (may warn)
- Concurrent editing by multiple users
