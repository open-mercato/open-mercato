# Test Scenario 012: Detention Charge Candidate Calculation

## Test ID
TC-WMS-012

## Category
Warehouse Management System

## Priority
Medium

## Type
API Test

## Description
Validate that detention fee rules produce charge candidates correctly while preserving the boundary that WMS does not generate invoices.

## Prerequisites
- User is authenticated as admin with yard-management permissions
- Warehouse, trailer, and detention fee rule exist
- Trailer dwell time can be simulated beyond the configured free-time threshold

## API Endpoint (for API tests)
`POST /api/wms/yard/detention-charges/:id/calculate`

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Create or prepare a detention scenario with known check-in/check-out timestamps | Trailer dwell context is defined |
| 2 | Apply a detention fee rule with known free-time and hourly rate | Rule is active and linked to the scenario |
| 3 | POST detention charge calculation | Response succeeds |
| 4 | Read the resulting detention charge candidate | Billable minutes and calculated fee match the rule inputs |
| 5 | Inspect billing-related outputs | WMS records a charge candidate/reference only, not an invoice |

## Expected Results
- Free-time, hourly rate, and cap logic are applied correctly
- Charge status transitions to a calculable state such as `calculated`
- Finance/billing ownership boundary is preserved
- Resulting charge is available for downstream consumption by a future billing module

## Edge Cases / Error Scenarios
- Dwell within free time should produce zero or no billable charge
- Max daily cap should be honored when dwell is very long
- Missing required timestamps should block calculation
