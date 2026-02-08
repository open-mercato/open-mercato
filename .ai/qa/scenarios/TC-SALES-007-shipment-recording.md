# Test Scenario 34: Record Order Shipment

## Test ID
TC-SALES-007

## Category
Sales Management

## Priority
High

## Description
Verify that shipments can be recorded against orders with tracking information and line item fulfillment.

## Prerequisites
- User is logged in with `sales.shipments.create` feature
- An order exists with line items ready for shipment
- Shipping methods are configured

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to order detail page | Order is displayed |
| 2 | Find shipments section | Shipments area visible |
| 3 | Click "Add Shipment" button | Shipment form appears |
| 4 | Select shipping method/carrier | Carrier is set |
| 5 | Enter tracking number | Tracking number accepted |
| 6 | Select items to ship | Line items selected with quantities |
| 7 | Enter shipped quantities | Quantities set |
| 8 | Set shipment date | Date is captured |
| 9 | Save shipment | Shipment is recorded |

## Expected Results
- Shipment record is created
- Shipment linked to order
- Tracking number is stored
- Carrier information captured
- Line items marked as shipped (full or partial)
- Order status may update (e.g., "Partially Shipped", "Shipped")
- Remaining quantities available for future shipments
- Shipment history shown on order
- Customer notification may be sent

## Edge Cases / Error Scenarios
- Ship more than ordered quantity (should be prevented)
- Ship from already fully shipped order (no items left)
- Ship zero quantity (should be prevented)
- Invalid tracking number format (may validate by carrier)
- Shipment date in future (may be allowed or prevented)
- Void/cancel shipment (if supported)
- Multiple shipments for same order (split shipment)
- Ship items from different locations (multi-warehouse)
