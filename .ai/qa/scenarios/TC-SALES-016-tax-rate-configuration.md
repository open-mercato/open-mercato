# Test Scenario 43: Configure Tax Rates

## Test ID
TC-SALES-016

## Category
Sales Management

## Priority
High

## Description
Verify that tax rates can be configured with geographic, customer, and product-based rules and priority ordering.

## Prerequisites
- User is logged in with `sales.tax.manage` feature
- Tax configuration page is accessible

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to tax rate configuration | Tax rates list displayed |
| 2 | Click "Add Tax Rate" | Tax rate form appears |
| 3 | Enter tax rate name (e.g., "State Sales Tax") | Name accepted |
| 4 | Enter tax rate percentage | Rate percentage set |
| 5 | Configure geographic scope | Country/state/region set |
| 6 | Configure product scope (categories) | Product rules set |
| 7 | Configure customer scope (tax exempt) | Customer rules set |
| 8 | Set priority for rate matching | Priority order set |
| 9 | Save tax rate | Rate is created |

## Expected Results
- Tax rate record is created
- Rate percentage is stored
- Geographic scope determines applicability
- Product categories can have different rates
- Tax-exempt customers bypass tax
- Priority determines which rate applies
- Multiple rates can stack (compound tax)
- Rate applies to new orders/invoices
- Tax reporting respects rate configuration

## Edge Cases / Error Scenarios
- Negative tax rate (should be prevented)
- Tax rate over 100% (should warn or prevent)
- Overlapping geographic scopes (use priority)
- No tax rate for location (may use default or zero)
- Tax rate with precision issues (decimal handling)
- Delete tax rate used in invoices (historical integrity)
- Tax rate effective dates (future rates)
- Tax holiday periods
- Cross-border tax rules (VAT/GST)
