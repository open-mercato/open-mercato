# Test Scenario 18: Shipment Cost Impact on Totals

## Test ID
TC-SALES-018

## Category
Sales Management

## Priority
High

## Type
UI Test

## Description
Verify that recording a shipment with shipping-cost adjustment enabled updates order totals and persists shipment tracking information.

## Prerequisites
- User is logged in with `sales.shipments.create` feature
- Shipping methods are configured
- An order exists with at least one shippable line item

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Create a new order with one line item | Initial grand total is visible |
| 2 | Open shipments and record shipment | Shipment dialog saves successfully |
| 3 | Return to totals section | Grand total reflects shipment-related cost impact |
| 4 | Verify shipment history | New shipment appears with tracking number |

## Expected Results
- Shipment record is created
- Tracking number is stored and visible on the order
- Grand total changes to reflect shipment-related financial impact

## Edge Cases / Error Scenarios
- Missing shipping method selection
- Attempting shipment with no available quantities
- Carrier/service without calculated shipping cost
