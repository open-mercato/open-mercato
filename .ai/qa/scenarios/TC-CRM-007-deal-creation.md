# Test Scenario 50: Create Deal

## Test ID
TC-CRM-007

## Category
Customer/CRM Management

## Priority
High

## Description
Verify that a sales deal/opportunity can be created with value, probability, and expected close date.

## Prerequisites
- User is logged in with `customers.deals.create` feature
- At least one customer (company or person) exists
- Deal stages/pipeline is configured

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/backend/customers/deals` | Deals list displayed |
| 2 | Click "Create Deal" button | Deal creation form appears |
| 3 | Enter deal name/title | Name accepted |
| 4 | Enter deal value/amount | Value stored |
| 5 | Set probability percentage | Probability entered |
| 6 | Set expected close date | Date selected |
| 7 | Select initial pipeline stage | Stage set |
| 8 | Link to customer (company/person) | Customer association created |
| 9 | Assign owner | Owner user set |
| 10 | Click "Save" button | Deal is created |

## Expected Results
- Deal record is created in database
- Deal has expected value and probability
- Weighted value calculated (value × probability)
- Deal appears in deals list
- Deal appears on pipeline board
- Deal linked to customer
- Owner is assigned for follow-up
- Custom fields stored
- Timeline shows creation activity

## Edge Cases / Error Scenarios
- Deal without customer (may be allowed as lead)
- Zero or negative deal value (may be allowed or error)
- Probability over 100% (validation error)
- Close date in past (may be allowed for won deals)
- Deal without stage (must have initial stage)
- Multiple deals for same customer (allowed)
- Deal currency different from default (multi-currency)
- Very high deal value (no practical limit)
