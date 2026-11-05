# Test Scenario 40: Configure Sales Channel

## Test ID
TC-SALES-013

## Category
Sales Management

## Priority
High

## Description
Verify that sales channels can be configured with appropriate settings, pricing rules, and status.

## Prerequisites
- User is logged in with `sales.channels.manage` feature
- Sales configuration page is accessible

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/backend/sales/channels` | Channels list is displayed |
| 2 | Click "Create Channel" button | Channel creation form appears |
| 3 | Enter channel name | Name is accepted |
| 4 | Enter channel code/identifier | Unique code set |
| 5 | Set channel status (active/inactive) | Status configured |
| 6 | Configure address/contact info | Business address set |
| 7 | Select default price kind | Pricing tier linked |
| 8 | Configure currency | Channel currency set |
| 9 | Save channel | Channel is created |

## Expected Results
- Channel record is created
- Channel has unique code
- Status determines if channel is usable
- Address is stored for documents
- Price kind determines product pricing
- Currency is set for transactions
- Channel appears in channel selection dropdowns
- Orders/quotes can be created for channel
- Channel can have custom offers

## Edge Cases / Error Scenarios
- Duplicate channel code (validation error)
- Empty channel name (validation error)
- Inactive channel in order creation (should be filtered)
- Delete channel with orders (may be prevented)
- Change channel currency with existing orders (versioning)
- Channel without price kind (use default)
- Channel-specific tax rules (cascading configuration)
- Multiple channels with same price kind
