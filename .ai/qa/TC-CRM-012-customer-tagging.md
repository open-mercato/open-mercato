# Test Scenario 55: Tag Customers for Segmentation

## Test ID
TC-CRM-012

## Category
Customer/CRM Management

## Priority
Medium

## Description
Verify that tags can be assigned to customers for segmentation and filtering purposes.

## Prerequisites
- User is logged in with `customers.edit` feature
- Customer exists
- Tag system is enabled

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to customer detail | Customer is displayed |
| 2 | Find tags section | Tags input visible |
| 3 | Type a new tag name | Autocomplete may suggest existing |
| 4 | Press Enter to add tag | Tag is added |
| 5 | Add multiple tags | Multiple tags displayed |
| 6 | Save customer | Tags persisted |
| 7 | Navigate to customers list | Filter by tag available |
| 8 | Filter by assigned tag | Customer appears in results |

## Expected Results
- Tags are assigned to customer
- Multiple tags per customer supported
- Tags are reusable across customers
- Tag autocomplete shows existing tags
- New tags can be created inline
- Tags appear in customer list
- Tags can be used for filtering
- Tag color/styling (if configured)
- Tags can be removed easily

## Edge Cases / Error Scenarios
- Duplicate tag assignment (no duplicates per customer)
- Very long tag name (max length)
- Special characters in tags (may be sanitized)
- Delete tag from system (remove from all customers)
- Case sensitivity (tags may normalize)
- Bulk tag assignment (if supported)
- Maximum tags per customer (limit if any)
- Tag used in automation rules
