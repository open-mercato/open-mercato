# Test Scenario 91: Attachments Transfer API

## Test ID
TC-API-BULK-004

## Category
Bulk Operations APIs

## Priority
Low

## Type
API Test

## Description
Verify that attachments can be transferred between records.

## Prerequisites
- Valid authentication token
- User has appropriate permissions
- Attachments exist on source record

## API Endpoint
`POST /api/attachments/transfer`

## Request Body
```json
{
  "attachmentIds": ["attach-1", "attach-2"],
  "targetEntityType": "customers.company",
  "targetEntityId": "company-456"
}
```

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Verify attachments on source | Attachments exist |
| 2 | Send POST to transfer | Transfer initiated |
| 3 | Verify response | Success message |
| 4 | Check target has attachments | Transferred successfully |
| 5 | Check source status | Copy or move behavior |

## Expected Response
```json
{
  "success": true,
  "transferredCount": 2,
  "targetEntityId": "company-456"
}
```

## Expected Results
- Attachments linked to target
- Source behavior (copy/move) as configured
- File storage unchanged
- Permissions checked on target
- Audit logged

## Edge Cases / Error Scenarios
- Non-existent attachment (error)
- Target doesn't accept attachments (error)
- Cross-organization transfer (prevented)
- Large attachment set
- Storage quota exceeded
