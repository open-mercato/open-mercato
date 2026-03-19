# Test Scenario 48: Link Person to Company

## Test ID
TC-CRM-005

## Category
Customer/CRM Management

## Priority
Medium

## Description
Verify that a person/contact can be linked to a company, establishing an employee relationship.

## Prerequisites
- User is logged in with `customers.people.edit` feature
- At least one person exists
- At least one company exists

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to person detail page | Person is displayed |
| 2 | Find company/organization section | Link option visible |
| 3 | Click "Link to Company" or edit company field | Company search/selection appears |
| 4 | Search for target company | Company results shown |
| 5 | Select the company | Company is linked |
| 6 | Set role/title at company (optional) | Role stored |
| 7 | Save changes | Link is established |
| 8 | View company page | Person appears in contacts |

## Expected Results
- Person-company relationship is created
- Person appears in company's contacts list
- Company appears on person's profile
- Role/title context is preserved
- Person can be linked to multiple companies (if allowed)
- Deal participants can reference this relationship
- Contact info is accessible from company view
- Unlinking removes the association

## Edge Cases / Error Scenarios
- Link to company in different organization (should be filtered)
- Link person already linked to same company (no duplicate)
- Remove company link (disassociate)
- Delete company with linked people (orphan or cascade)
- Delete person linked to company (company contacts updated)
- Link to deleted company (should not be possible)
- Change company link (update, not duplicate)
- Primary company designation (if person has multiple)
