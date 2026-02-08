# Test Scenario 45: Company Creation Validation Errors

## Test ID
TC-CRM-002

## Category
Customer/CRM Management

## Priority
Medium

## Description
Verify that the company creation form properly validates inputs and displays appropriate error messages.

## Prerequisites
- User is logged in with `customers.companies.create` feature
- Company creation form is accessible

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/backend/customers/companies/create` | Company form displayed |
| 2 | Submit form with empty name | Validation error for name |
| 3 | Enter invalid website URL (e.g., "notaurl") | Validation error for URL |
| 4 | Enter invalid email format | Email validation error |
| 5 | Enter very long text in name field | Max length error or truncation |
| 6 | Leave required custom fields empty | Custom field validation errors |
| 7 | Fill all required fields correctly | Form ready for submission |

## Expected Results
- Empty name: "Company name is required" error
- Invalid URL: "Invalid website URL" error
- Invalid email: "Invalid email format" error
- Field-level errors displayed next to fields
- Form does not submit until validation passes
- Errors cleared when fields corrected
- Form state preserved after validation failure

## Edge Cases / Error Scenarios
- Website without protocol (should auto-add https://)
- Email with plus sign (user+tag@email.com - valid)
- Unicode characters in company name (should be allowed)
- HTML/XSS in text fields (should be sanitized)
- Phone number format validation (if applicable)
- Tax ID format validation (country-specific)
- Concurrent creation of same company (race condition)
