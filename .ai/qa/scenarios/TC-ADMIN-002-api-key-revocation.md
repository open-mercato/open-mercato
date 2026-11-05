# Test Scenario 60: Revoke API Key

## Test ID
TC-ADMIN-002

## Category
System Administration

## Priority
Medium

## Description
Verify that API keys can be revoked, immediately preventing their use.

## Prerequisites
- User is logged in with `api_keys.manage` feature
- At least one active API key exists

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/backend/api-keys` | API keys list displayed |
| 2 | Find target API key | Key visible in list |
| 3 | Click "Revoke" action | Confirmation dialog appears |
| 4 | Confirm revocation | Revocation proceeds |
| 5 | Observe success response | Success notification shown |
| 6 | Verify key status changes | Key marked as revoked |
| 7 | Attempt API call with revoked key | Authentication fails |

## Expected Results
- Key is marked as revoked (not deleted)
- Key appears in list with revoked status
- Key immediately stops working
- API calls with key return 401 Unauthorized
- Revocation is logged for audit
- Revoked key cannot be re-enabled
- Key remains in history for audit trail

## Edge Cases / Error Scenarios
- Revoke already revoked key (should be no-op or error)
- Revoke key currently in use (immediate effect)
- Revoke own key while using it (session continues, key fails)
- Revoke all keys (at least one must remain - if enforced)
- Revoke key from different org (access denied)
- Key revocation with open connections
- Bulk revoke keys (if supported)
- Expired key revocation (may be automatic)
