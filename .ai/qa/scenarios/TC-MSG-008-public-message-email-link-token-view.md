# Test Scenario 008: Public Message Email Link Token View

## Test ID
TC-MSG-008

## Category
Messages

## Priority
High

## Type
UI Test

## Description
Validates that a user can open the public token-based message view and read message content without navigating through backend inbox screens.

## Prerequisites
- A message was sent with `sendViaEmail=true` and generated access token
- Test has access to a valid token URL `/messages/view/{token}`

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open `/messages/view/{token}` in browser | Public token page loads |
| 2 | Wait for message fetch completion | Subject/body/sent timestamp are rendered |
| 3 | Verify object and attachment sections | Linked objects and attachments appear when present |
| 4 | Refresh page with same valid token (if reusable in current policy) | Page shows either message again or clear token-usage state response |
| 5 | Open an invalid/expired token URL | Error message is displayed (`invalid`, `expired`, or `limit exceeded`) |

## Expected Results
- Valid token resolves to message view payload
- Token error states are handled with user-facing messages
- Public route does not expose inbox management actions

## Edge Cases / Error Scenarios
- Protected object payload may require sign-in and show `Sign in required`
