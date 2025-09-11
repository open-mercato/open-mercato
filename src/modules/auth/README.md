# Auth Module

Features:
- Public login page at `/login`.
- Admin page at `/backend/auth`.
- API endpoint `POST /api/auth/login`.
- CLI:
  - `erp auth add-user --email <e> --password <p> --organizationId <id> [--roles r1,r2]`
  - `erp auth seed-roles`
  - `erp auth add-org --name <org>`
  - `erp auth setup --orgName <org> --email <e> --password <p> [--roles owner,admin]`

DB entities used (defined in root schema):
- `users` with: `email`, `password_hash`, `is_confirmed`, `last_login_at`, `organization_id`, timestamps.
- `roles` (name unique) and `user_roles` junction.

Notes:
- Passwords are hashed with `bcryptjs`.
- Session management will be added later; login redirects to `/backend` on success.
