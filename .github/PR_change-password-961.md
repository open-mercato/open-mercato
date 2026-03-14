# Fix: Change password — masked fields, current password required (self-service)

## What was done

- **CrudForm**: added field type `'password'` for masked inputs in forms.
- **Profile / Change password** (both views): "Current password" field; password and confirm as `type: 'password'`; validation requires current password when changing; payload sends `currentPassword`.
- **`PUT /api/auth/profile`**: when `password` is in body, `currentPassword` is required; verification via `AuthService.verifyPassword()`; on failure → 400 with `issues` for `currentPassword`. Email-only update unchanged.
- **i18n**: labels and errors (currentPasswordRequired, currentPasswordInvalid, newPasswordRequired, confirmPasswordRequired) in en, pl, de, es.
- **TC-AUTH-019**: integration tests — success with correct current password; 400 when current password missing or wrong.

Admin API (`PUT /api/auth/users`) and CLI `set-password` unchanged — admins can still set a user's password without the old one.

**Verify:**  
`BASE_URL=http://localhost:3000 yarn test:integration packages/core/src/modules/auth/__integration__/TC-AUTH-018.spec.ts packages/core/src/modules/auth/__integration__/TC-AUTH-019.spec.ts`

Closes #961
