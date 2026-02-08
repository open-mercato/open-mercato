# Test Scenario 57: Delete Customer

## Test ID
TC-CRM-014

## Category
Customer/CRM Management

## Priority
Medium

## Description
Verify that customers can be deleted with proper handling of related records and data retention.

## Prerequisites
- User is logged in with `customers.delete` feature
- Customer exists that can be safely deleted
- Understand cascade/orphan behavior for related data

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/backend/customers/companies` or people | Customer list displayed |
| 2 | Find target customer | Customer visible in list |
| 3 | Click "Delete" action | Confirmation dialog appears |
| 4 | Review deletion warning | Related data warning shown |
| 5 | Confirm deletion | Deletion proceeds |
| 6 | Observe success response | Success notification shown |
| 7 | Verify customer removed from list | Customer not visible |
| 8 | Check related records | Deals, activities handled |

## Expected Results
- Customer is soft-deleted (deleted_at set)
- Customer removed from active lists
- Related deals may be orphaned or cascade deleted
- Related activities preserved for history
- Addresses removed or orphaned
- Tags assignments removed
- Customer not searchable
- Historical orders/invoices retain customer snapshot
- Deletion is audited

## Edge Cases / Error Scenarios
- Delete customer with active orders (may be prevented)
- Delete customer with unpaid invoices (may be prevented)
- Delete company with linked people (cascade or prevent)
- Delete person linked to deals (deal handling)
- Restore deleted customer (if supported)
- Hard delete for GDPR compliance (if required)
- Delete customer from different org (access denied)
- Delete own company (if user is linked - prevent)
