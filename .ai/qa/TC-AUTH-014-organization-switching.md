# Test Scenario 14: Organization Switching

## Test ID
TC-AUTH-014

## Category
Authentication & User Management

## Priority
High

## Description
Verify that users can switch between organizations they have access to, and that data is properly filtered based on the selected organization.

## Prerequisites
- User is logged in
- User has access to multiple organizations
- Organization switcher is visible in the UI
- Data exists in multiple organizations for comparison

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to any backend page | Page loads with current org context |
| 2 | Click organization switcher dropdown | Organization hierarchy is displayed |
| 3 | Verify current selection is highlighted | Selected org is marked |
| 4 | Observe organization tree structure | Parent/child relationships shown |
| 5 | Select a different organization | Selection is updated |
| 6 | Wait for page to reload/update | Cookie is set, context changes |
| 7 | Observe data on current page | Data is filtered to selected org |
| 8 | Navigate to another page | New org context is maintained |

## Expected Results
- GET `/api/organization-switcher` returns accessible organizations
- Organizations are displayed in hierarchical tree format
- Currently selected organization is visually marked
- Inactive organizations may be shown (with visual indicator)
- `selectedOrganization` cookie is set on selection
- All subsequent API calls include organization scope
- Data tables/lists show only data for selected organization
- "All Organizations" option shows aggregate data (if permitted)

## Edge Cases / Error Scenarios
- User has access to only one organization (switcher may be hidden)
- User has access to parent but not child orgs (child orgs hidden)
- Super admin sees all organizations
- Switch to inactive organization (may be prevented or allowed)
- Organization deleted after loading switcher (should refresh)
- Cookie tampering with unauthorized org ID (should be rejected by API)
- User's org access revoked while session active (should be handled gracefully)
