# Test Scenario 1: Create pipeline and configure stages

## Test ID
TC-CRM-001

## Category
CRM

## Priority
High

## Description
Verify that an admin user can create a new sales pipeline and configure its stages in **Settings > Customers > Pipeline stages**.

## Prerequisites
- User is logged in and has permissions to manage Settings / Customers configuration.
- At least one pipeline already exists (system default).

## Test Steps

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Go to **Settings > Customers > Pipeline stages**. | Pipeline stages settings screen is visible. |
| 2 | Create a new pipeline named `Renewals`. | Pipeline `Renewals` is created and selectable. |
| 3 | Add stages: `Health Check`, `Renewal Offer`, `Negotiation`, `Closed Won`, `Closed Lost`. | All stages are added under pipeline `Renewals`. |
| 4 | Reorder stages so `Health Check` is first. | Stage order is updated and persisted after refresh. |

## Expected Results
- Pipeline `Renewals` exists.
- Stages exist and keep the configured order after refresh.

## Edge Cases / Error Scenarios
- Attempt to create a pipeline with an empty name → validation error.
- Attempt to create duplicate pipeline name (if uniqueness enforced) → validation error.
