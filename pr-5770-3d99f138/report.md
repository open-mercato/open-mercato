# Auth ACL QA evidence

Verified local head `3e661f863e9666d648ace536fc14cdca1567a45a`:8 live security API cases,4 browser checkpoints and11 committed integration cases passed. Migration up/down2/2 passed separately at the same source. Self-created disposable fixtures only; evidence does not grant QA approval.

## 1. Evaluate isolated user-live principal
PASS: {"featureGranted": true, "listStatus": 200, "loginStatus": 200}

## 2. Evaluate isolated role-live principal
PASS: {"featureGranted": true, "listStatus": 200, "loginStatus": 200}

## 3. Evaluate isolated user-revoked principal
PASS: {"featureGranted": false, "listStatus": 403, "loginStatus": 200}

## 4. Evaluate isolated role-revoked principal
PASS: {"featureGranted": false, "listStatus": 403, "loginStatus": 200}

## 5. Evaluate isolated membership-revoked principal
PASS: {"featureGranted": false, "listStatus": 403, "loginStatus": 200}

## 6. Evaluate isolated role-deleted principal
PASS: {"featureGranted": false, "listStatus": 403, "loginStatus": 200}

## 7. Evaluate isolated foreign-superadmin principal
PASS: {"featureGranted": false, "listStatus": 403, "loginStatus": 200}

## 8. Evaluate isolated tenantless-superadmin principal
PASS: {"featureGranted": false, "listStatus": 403, "loginStatus": 200}

## 9. Actual user edit and current access-control panel finish loading
PASS: Actual user edit and current access-control panel finish loading
![Actual user edit and current access-control panel finish loading](access-ready.png)

## 10. User edit remains accessible at390px
PASS: User edit remains accessible at390px
![User edit remains accessible at390px](access-mobile.png)

## 11. User list displays self-created fixtures after loading
PASS: User list displays self-created fixtures after loading
![User list displays self-created fixtures after loading](users-ready.png)

## 12. A real principal with a revoked override cannot render the guarded user list
PASS: A real principal with a revoked override cannot render the guarded user list
![A real principal with a revoked override cannot render the guarded user list](revoked-access-denied.png)

## AUTH-01 stale role-name edit shows the conflict bar
![AUTH-01 stale role-name edit shows the conflict bar](role-edit-conflict.png)

## AUTH-05 stale role delete shows the conflict bar
![AUTH-05 stale role delete shows the conflict bar](role-delete-conflict.png)

## AUTH-03 stale user edit shows the conflict bar
![AUTH-03 stale user edit shows the conflict bar](user-edit-conflict.png)
