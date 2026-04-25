# Auth Module

Features:
- Public login page at `/login`.
- Admin page at `/backend/auth`.
- API endpoint `POST /api/auth/login`.
- CLI:
  - `mercato auth add-user --email <e> --password <p> --organizationId <id> [--roles r1,r2]`
  - `mercato auth seed-roles`
  - `mercato auth add-org --name <org>`
  - `mercato auth setup --orgName <org> --email <e> --password <p> [--roles superadmin,admin] [--skip-password-policy]`
  - `mercato auth sync-role-acls [--tenant <tenantId>] [--no-superadmin]` — re-applies each enabled module's `defaultRoleFeatures` to existing tenants. Idempotent and additive (existing custom features are preserved). Run after deploying new module features to ensure existing tenants pick them up; without `--tenant` it iterates every tenant.

DB entities used (defined in root schema):
- `users` with: `email`, `password_hash`, `is_confirmed`, `last_login_at`, `organization_id`, timestamps.
- `roles` (name unique) and `user_roles` junction.

Notes:
- Passwords are hashed with `bcryptjs`.
- Session management will be added later; login redirects to `/backend` on success.
