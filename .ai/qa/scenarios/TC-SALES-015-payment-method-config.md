# Test Scenario 42: Configure Payment Method

## Test ID
TC-SALES-015

## Category
Sales Management

## Priority
Medium

## Description
Verify that payment methods can be configured with terms, provider settings, and availability rules.

## Prerequisites
- User is logged in with `sales.payments.manage` feature
- Payment configuration page is accessible

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to payment methods configuration | Payment methods list displayed |
| 2 | Click "Add Payment Method" | Payment method form appears |
| 3 | Enter method name (e.g., "Net 30") | Name accepted |
| 4 | Enter method code | Unique code set |
| 5 | Select payment type (invoice, credit card, etc.) | Type configured |
| 6 | Configure payment terms (days to pay) | Terms set |
| 7 | Enter provider key (if integrated) | Integration key stored |
| 8 | Set availability rules | Customer/channel limits set |
| 9 | Save payment method | Method is created |

## Expected Results
- Payment method record is created
- Method has unique code
- Payment terms determine due dates
- Provider integration configured (if any)
- Method available in order/invoice forms
- Due dates calculated from terms
- Method can be limited to specific customers
- Method can be limited to specific channels
- Early payment discounts (if configured)

## Edge Cases / Error Scenarios
- Duplicate method code (validation error)
- Negative payment terms (immediate payment)
- Zero days terms (cash on delivery)
- Method without provider (manual recording)
- Delete method used in invoices (may be prevented)
- Customer-specific payment terms override
- Credit limit enforcement
- Provider API failure handling
