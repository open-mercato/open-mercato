# Test Scenario 17: Product Creation Validation Errors

## Test ID
TC-CAT-002

## Category
Catalog Management

## Priority
Medium

## Description
Verify that the product creation form properly validates all inputs and displays appropriate error messages for invalid data.

## Prerequisites
- User is logged in with `catalog.products.create` feature
- Product creation form is accessible
- Existing product with known SKU for duplicate testing

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/backend/catalog/products/create` | Product creation form is displayed |
| 2 | Submit form with empty name | Validation error for name |
| 3 | Enter name, submit with empty SKU | Validation error for SKU (if required) |
| 4 | Enter duplicate SKU | Validation error for duplicate SKU |
| 5 | Enter negative values in numeric fields | Validation error or auto-correction |
| 6 | Enter invalid data in custom fields | Field-level validation errors |
| 7 | Fill all required fields correctly | Form is ready for submission |

## Expected Results
- Empty name: "Product name is required" error
- Duplicate SKU: "SKU already exists" error
- Invalid numeric values: Appropriate validation message
- Required custom fields empty: Field-level errors
- Form does not submit until all validation passes
- Field-level errors are displayed next to respective fields
- Errors are cleared when field is corrected
- Form state is preserved after validation failure

## Edge Cases / Error Scenarios
- SKU with spaces (may be trimmed or rejected)
- SKU with special characters (may be allowed or restricted)
- Name exceeding maximum length (truncated or error)
- Description with embedded scripts (XSS protection)
- Category that was deleted while form was open (should refresh options)
- Concurrent creation with same SKU (race condition handling)
- Very large file attachments (size validation)
