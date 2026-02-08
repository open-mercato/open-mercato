# Test Scenario 51: Add Participants to Deal

## Test ID
TC-CRM-008

## Category
Customer/CRM Management

## Priority
Medium

## Description
Verify that multiple people and companies can be linked to a deal as participants.

## Prerequisites
- User is logged in with `customers.deals.edit` feature
- A deal exists
- Multiple customers (people/companies) exist

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to deal detail page | Deal is displayed |
| 2 | Find participants section | Participants list visible |
| 3 | Click "Add Participant" | Participant selection appears |
| 4 | Search for a person | Person results shown |
| 5 | Select person and set role | Person linked as participant |
| 6 | Add another participant (company) | Company added |
| 7 | Set participant role (decision maker, etc.) | Role assigned |
| 8 | Save changes | Participants are saved |

## Expected Results
- Person-deal link created (CustomerDealPersonLink)
- Company-deal link created (CustomerDealCompanyLink)
- Multiple participants allowed
- Roles can be assigned (decision maker, influencer, etc.)
- Participants visible on deal detail
- Deal visible on participant's profile
- Removing participant removes link only
- Primary contact can be designated

## Edge Cases / Error Scenarios
- Add same person twice (should prevent duplicate)
- Add person from different organization (should be filtered)
- Remove all participants (may be allowed)
- Delete participant (person/company) - deal link handling
- Participant role is optional
- Bulk add participants (if supported)
- Participant not linked to deal's primary company
- Primary contact designation changes
