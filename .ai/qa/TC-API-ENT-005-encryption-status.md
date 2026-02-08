# Test Scenario 85: Entity Encryption Status API

## Test ID
TC-API-ENT-005

## Category
Custom Fields & Entities APIs

## Priority
Medium

## Type
API Test

## Description
Verify that encryption status can be retrieved and configured for entities.

## Prerequisites
- Valid authentication token
- User has `entities.encryption.manage` feature
- Tenant data encryption is enabled

## API Endpoint
- `GET /api/entities/encryption` - Get status
- `POST /api/entities/encryption` - Set status

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send GET request | Encryption status returned |
| 2 | Verify entity encryption flags | Status per entity |
| 3 | Send POST to enable encryption | Entity marked |
| 4 | Verify data is encrypted | Check stored data |
| 5 | Query encrypted data | Decrypted on read |

## Expected Response (GET)
```json
{
  "entities": {
    "customers.company": { "encrypted": true, "fields": ["email", "phone"] },
    "customers.person": { "encrypted": true, "fields": ["name", "email"] }
  },
  "encryptionEnabled": true,
  "keyStatus": "active"
}
```

## Expected Results
- Encryption status per entity shown
- Field-level encryption visible
- Key status reported
- Toggle encryption works
- Data remains accessible

## Edge Cases / Error Scenarios
- Encryption service down (error state)
- Enable on large dataset (async migration)
- Disable encryption (data decryption)
- Key rotation in progress
- Encrypted field query performance
