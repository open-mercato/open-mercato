# Test Scenario 44: Create Company

## Test ID
TC-CRM-001

## Category
Customer/CRM Management

## Priority
High

## Description
Verify that a new company record can be created with all relevant business information and custom fields.

## Prerequisites
- User is logged in with `customers.companies.create` feature
- Company creation page is accessible
- Custom fields are configured (if applicable)

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/backend/customers/companies` | Companies list is displayed |
| 2 | Click "Create Company" button | Company creation form appears |
| 3 | Enter company name | Name is accepted |
| 4 | Enter legal name (if different) | Legal name stored |
| 5 | Enter website URL | URL validated and stored |
| 6 | Select industry | Industry category set |
| 7 | Set company size/employees | Size range selected |
| 8 | Set revenue range (optional) | Revenue range stored |
| 9 | Fill custom fields | Custom values entered |
| 10 | Click "Save" button | Company is created |

## Expected Results
- Company record is created in database
- Company is scoped to current tenant/organization
- Display name is computed
- Company appears in companies list
- Company is searchable
- Company can be linked to contacts
- Custom field values are stored
- Lifecycle stage is set (default or selected)
- Owner can be assigned

## Edge Cases / Error Scenarios
- Duplicate company name (may be allowed with warning)
- Empty company name (validation error)
- Invalid website URL (validation error)
- Very long company name (max length validation)
- Special characters in name (should be handled)
- Company without address (may be allowed initially)
- Company with social links (LinkedIn, etc.)
- Import company from external source
