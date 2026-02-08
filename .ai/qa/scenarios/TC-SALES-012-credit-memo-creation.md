# Test Scenario 39: Create Credit Memo

## Test ID
TC-SALES-012

## Category
Sales Management

## Priority
Medium

## Description
Verify that credit memos can be created for returns, refunds, or billing corrections, properly crediting the customer account.

## Prerequisites
- User is logged in with `sales.credit-memos.create` feature
- An invoice or order exists to credit against
- Credit memo types are configured

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to invoice or order detail | Document is displayed |
| 2 | Click "Create Credit Memo" button | Credit memo form appears |
| 3 | Select reason for credit | Reason code selected |
| 4 | Select items to credit | Line items chosen |
| 5 | Enter credit quantities | Quantities set |
| 6 | Review credit amounts | Negative amounts shown |
| 7 | Add credit notes/description | Notes captured |
| 8 | Save credit memo | Credit memo created |

## Expected Results
- Credit memo record is created with unique number
- Credit memo linked to original invoice/order
- Credit amounts are negative or flagged as credits
- Customer account balance is increased (credit)
- Original document shows credit memo link
- Credit can be applied to future invoices
- Credit can be refunded to payment method
- Tax is adjusted accordingly
- Inventory may be adjusted for returns

## Edge Cases / Error Scenarios
- Credit more than original invoice (may be prevented)
- Credit already credited items (track credited amounts)
- Credit memo on paid invoice (may affect payment allocation)
- Return without credit memo (separate inventory adjustment)
- Credit memo with different tax rate (use original rates)
- Void credit memo (if supported)
- Credit memo for partial quantity
- Credit memo affects commission calculations
