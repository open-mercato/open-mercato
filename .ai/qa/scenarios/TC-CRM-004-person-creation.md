# Test Scenario 47: Create Contact/Person

## Test ID
TC-CRM-004

## Category
Customer/CRM Management

## Priority
High

## Description
Verify that a new contact/person record can be created with personal information and company association.

## Prerequisites
- User is logged in with `customers.people.create` feature
- Person creation page is accessible
- At least one company exists (for linking)

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/backend/customers/people` | People list displayed |
| 2 | Click "Create Contact" button | Person creation form appears |
| 3 | Enter first name | First name accepted |
| 4 | Enter last name | Last name accepted |
| 5 | Enter email address | Email validated and stored |
| 6 | Enter phone number | Phone stored |
| 7 | Enter job title | Title stored |
| 8 | Enter department | Department stored |
| 9 | Link to company (optional) | Company association set |
| 10 | Click "Save" button | Person is created |

## Expected Results
- Person record is created in database
- Full name is computed from first/last
- Person is scoped to tenant/organization
- Email can be used for communication
- Company link is established (if selected)
- Person appears in people list
- Person is searchable
- Custom fields are stored
- Social links can be added (LinkedIn, etc.)

## Edge Cases / Error Scenarios
- Person without company link (allowed for independent contacts)
- Duplicate email address (may warn or prevent)
- Empty first and last name (validation error)
- Person with only email (minimal valid record)
- Multiple phone numbers (if supported)
- International phone format (validation)
- Person with multiple company affiliations (if supported)
- Import person from external source
