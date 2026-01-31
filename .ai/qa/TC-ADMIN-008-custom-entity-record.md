# Test Scenario 66: Create Custom Entity Record

## Test ID
TC-ADMIN-008

## Category
System Administration

## Priority
Medium

## Description
Verify that records can be created for custom entities with field validation.

## Prerequisites
- User is logged in with `entities.records.create` feature
- Custom entity exists with defined fields
- Record creation page is accessible

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to custom entity records page | Records list displayed |
| 2 | Click "Create Record" button | Record form appears |
| 3 | Fill in required fields | Values entered |
| 4 | Fill in optional fields | Values entered |
| 5 | Enter invalid data in typed field | Validation error shown |
| 6 | Correct the invalid data | Error cleared |
| 7 | Save record | Record is created |
| 8 | View record in list | Record appears |
| 9 | Edit record | Values can be updated |

## Expected Results
- Record is created in database
- Record linked to entity definition
- Field values stored correctly
- Required fields enforced
- Type validation works (number, date, email)
- Record appears in list view
- Record can be edited
- Record can be deleted
- Custom field values searchable

## Edge Cases / Error Scenarios
- Missing required fields (validation error)
- Wrong data type (validation error)
- Very long text values (max length)
- Special characters in fields (handled)
- Concurrent record creation (no conflicts)
- Delete record (soft delete)
- Record with relation fields (foreign entity)
- Bulk import records (if supported)
