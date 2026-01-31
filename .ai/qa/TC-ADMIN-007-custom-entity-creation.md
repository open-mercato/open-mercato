# Test Scenario 65: Create Custom Entity Definition

## Test ID
TC-ADMIN-007

## Category
System Administration

## Priority
Medium

## Description
Verify that custom entity definitions can be created to extend the data model.

## Prerequisites
- User is logged in with `entities.manage` feature
- Custom entity management page is accessible

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/backend/entities/user` | Custom entities list displayed |
| 2 | Click "Create Entity" button | Entity creation form appears |
| 3 | Enter entity name | Name accepted |
| 4 | Enter entity identifier/code | Code set |
| 5 | Add custom fields | Field definitions added |
| 6 | Set field types (text, number, date, etc.) | Types configured |
| 7 | Set required/optional flags | Validation set |
| 8 | Save entity definition | Entity is created |
| 9 | Navigate to entity records | Records page accessible |

## Expected Results
- Entity definition is created
- Entity has unique code
- Fields are defined with types
- Entity appears in entities list
- Records can be created for entity
- Fields validate according to type
- Entity is organization-scoped
- Entity supports CRUD operations

## Edge Cases / Error Scenarios
- Duplicate entity code (validation error)
- Empty entity name (validation error)
- Entity with no fields (may be allowed)
- Reserved field names (should prevent)
- Change field type after records exist (may prevent)
- Delete entity with records (cascade or prevent)
- Maximum fields per entity (limit if any)
- Field with complex validation rules
