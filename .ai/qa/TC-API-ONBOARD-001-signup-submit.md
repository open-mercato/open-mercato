# Test Scenario 108: Onboarding Signup Submit API

## Test ID
TC-API-ONBOARD-001

## Category
Onboarding APIs

## Priority
High

## Type
API Test

## Description
Verify that self-service signup submissions are processed correctly.

## Prerequisites
- Onboarding module is enabled
- Public API access (no auth required)
- Email service configured

## API Endpoint
`POST /api/onboarding/onboarding`

## Request Body
```json
{
  "email": "newuser@company.com",
  "password": "securePassword123",
  "companyName": "New Company Inc",
  "fullName": "John Smith",
  "termsAccepted": true
}
```

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send POST with signup data | Request accepted |
| 2 | Verify response | Pending verification |
| 3 | Check email sent | Verification email |
| 4 | Verify no immediate access | Cannot login yet |
| 5 | Check pending record | Record created |

## Expected Response
```json
{
  "success": true,
  "message": "Verification email sent",
  "email": "newuser@company.com",
  "pendingId": "pending-123"
}
```

## Expected Results
- Signup data validated
- Pending record created
- Verification email sent
- No tenant created yet
- Rate limiting applied

## Edge Cases / Error Scenarios
- Duplicate email (error)
- Invalid email format (validation)
- Weak password (validation)
- Terms not accepted (error)
- Email service failure (retry)
- Rate limit exceeded (429)
