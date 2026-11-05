# Test Scenario 71: Product Creation to Sales Channel to Order

## Test ID
TC-INT-003

## Category
Integration Scenarios

## Priority
High

## Description
Verify that products can be created, configured for a sales channel, and successfully ordered.

## Prerequisites
- User is logged in with catalog and sales permissions
- Sales channel exists
- Customer exists

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Create new product | Product created |
| 2 | Add product variant | Variant with SKU |
| 3 | Set variant pricing | Price for default price kind |
| 4 | Add product to category | Category assignment |
| 5 | Assign tags | Tags attached |
| 6 | Create channel offer (optional) | Offer for channel |
| 7 | Navigate to order creation | Order form displayed |
| 8 | Select the sales channel | Channel context set |
| 9 | Search for new product | Product appears in search |
| 10 | Add product to order | Line item created |
| 11 | Verify price from catalog | Price matches setup |
| 12 | Complete order | Order saved |
| 13 | Verify product in order detail | Product info correct |

## Expected Results
- Product available for ordering immediately
- Correct price applied based on price kind
- Channel-specific offer used (if applicable)
- Product searchable by name/SKU
- Variant correctly identified
- Category helps filtering
- Tags enable quick finding
- Order captures product snapshot

## Edge Cases / Error Scenarios
- Product without variant (base product not orderable)
- Product without price (validation error on order)
- Inactive product (should not appear)
- Product in wrong channel (filtered out)
- Price with future validity (current price used)
- Multiple variants same product (correct one selected)
- Product deleted after order (snapshot preserved)
- Catalog sync delays (eventual consistency)
