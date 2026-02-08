# Test Scenario 49: Customer Address Management

## Test ID
TC-CRM-006

## Category
Customer/CRM Management

## Priority
High

## Description
Verify that multiple addresses can be added to customers with proper labeling and default designation.

## Prerequisites
- User is logged in with `customers.edit` feature
- Customer (company or person) exists
- Address fields are configured

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to customer detail page | Customer is displayed |
| 2 | Find addresses section | Addresses list/panel visible |
| 3 | Click "Add Address" button | Address form appears |
| 4 | Enter address label (e.g., "Headquarters") | Label accepted |
| 5 | Enter street address line 1 | Address stored |
| 6 | Enter city, state/province, postal code | Location fields filled |
| 7 | Select country | Country set |
| 8 | Mark as default billing/shipping | Default flags set |
| 9 | Save address | Address is created |
| 10 | Add second address | Multiple addresses supported |

## Expected Results
- Address record is linked to customer
- Multiple addresses per customer supported
- Each address can have a label
- Default billing address designated
- Default shipping address designated
- Addresses available in order/invoice forms
- Address format follows country conventions
- Address appears in customer profile

## Edge Cases / Error Scenarios
- Address without required fields (validation)
- Very long address lines (max length)
- Special characters in address (should be handled)
- Set multiple defaults (should only allow one)
- Delete default address (must set new default)
- International addresses (different formats)
- Address validation/verification (if integrated)
- Copy address to another customer
