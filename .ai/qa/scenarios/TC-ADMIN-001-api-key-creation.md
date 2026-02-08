# Test Scenario 59: Create API Key

## Test ID
TC-ADMIN-001

## Category
System Administration

## Priority
Medium

## Description
Verify that API keys can be created for programmatic access to the system.

## Prerequisites
- User is logged in with `api_keys.manage` feature
- API key management page is accessible

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/backend/api-keys` | API keys list displayed |
| 2 | Click "Create API Key" button | Creation form appears |
| 3 | Enter key name/description | Name accepted |
| 4 | Select permissions/scopes | Scopes assigned to key |
| 5 | Set expiration date (optional) | Expiration configured |
| 6 | Click "Create" button | Key is generated |
| 7 | View generated key | Key shown (one-time display) |
| 8 | Copy key to clipboard | Key can be copied |
| 9 | Dismiss dialog | Key is hidden |

## Expected Results
- API key record is created
- Key is generated securely (random, sufficient entropy)
- Key is shown only once after creation
- Key is hashed before storage (cannot retrieve later)
- Key appears in keys list (masked)
- Key can be used for API authentication
- Permissions limit key capabilities
- Expiration is enforced if set

## Edge Cases / Error Scenarios
- Empty key name (validation error)
- Key with no permissions (may be allowed or prevented)
- Expired key creation (past date - should prevent)
- Maximum keys per user/organization (limit if any)
- Key without expiration (permanent key - may warn)
- Duplicate key name (may be allowed)
- View key after dialog closed (cannot - security)
- Copy key failure (fallback to manual copy)
