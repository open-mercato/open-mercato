# Test Scenario 70: Customer to Deal to Quote to Order Flow

## Test ID
TC-INT-002

## Category
Integration Scenarios

## Priority
High

## Description
Verify the CRM-driven sales flow from customer acquisition through deal tracking to order fulfillment.

## Prerequisites
- User is logged in with CRM and sales permissions
- Products exist in catalog
- Pipeline stages are configured

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Create new company | Company created |
| 2 | Add contact person | Person linked to company |
| 3 | Add company address | Address available for orders |
| 4 | Create deal for company | Deal in initial stage |
| 5 | Add person as deal participant | Participant linked |
| 6 | Record meeting activity | Activity on timeline |
| 7 | Move deal through pipeline | Stage updates |
| 8 | Create quote linked to deal | Quote references deal |
| 9 | Convert quote to order | Order created |
| 10 | Move deal to "Won" stage | Deal closed-won |
| 11 | Verify deal value matches order | Consistency check |
| 12 | Check customer's order history | Order appears |

## Expected Results
- Customer journey captured from lead to order
- Deal tracks opportunity value
- Activities document interactions
- Quote conversion creates order
- Deal outcome reflects order status
- Customer profile shows complete history
- Reports aggregate deal metrics
- Sales team visibility complete

## Edge Cases / Error Scenarios
- Deal without customer (lead-only)
- Multiple quotes for same deal
- Deal lost after quote sent
- Order cancellation after deal won
- Customer moves to different company
- Deal reassignment to different owner
- Multiple deals for same customer
- Deal value differs from order value
