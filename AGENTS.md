# Agents Guidelines

This repository is designed for extensibility. Agents should leverage the module system and follow strict naming and coding conventions to keep the system consistent and safe to extend.

## Conventions
- Modules: plural, snake_case (folders and `id`). Special cases: `auth`, `example`.
- JS/TS fields and identifiers: camelCase.
- Database tables and columns: snake_case; table names plural.
- Keep code minimal and focused; avoid side effects across modules.

## Extensibility Contract
- Auto-discovery:
  - Frontend pages under `src/modules/<module>/frontend/<path>.tsx` → `/<path>`
  - Backend pages under `src/modules/<module>/backend/<path>.tsx` → `/backend/<path>`
  - Special case: `src/modules/<module>/backend/page.tsx` → `/backend/<module>`
  - API under `src/modules/<module>/api/<method>/<path>.ts` → `/api/<path>` dispatched by method
  - Optional CLI at `src/modules/<module>/cli.ts` default export
- Database schemas live in `src/modules/<module>/db/schema.ts` and are picked by drizzle-kit.
- A generator builds `src/modules/generated.ts`; run `npm run modules:generate` or rely on `predev`/`prebuild`.

## Database Naming
- Tables: plural snake_case (e.g., `users`, `user_roles`, `example_items`).
- Common columns: `id`, `created_at`, `updated_at`, `is_active`, `organization_id` when applicable.
- Prefer integer PKs (`serial`) and explicit FKs; use junction tables for many-to-many.

## Multi-tenant Rules
- Always include and filter by `organization_id` for tenant-scoped entities.
- Never expose cross-tenant data from API handlers.
- Authentication must attach organization context explicitly.

## Security and Quality
- Validate all inputs with `zod`.
- Use parameterized queries (via drizzle) and never interpolate into SQL strings.
- Hash passwords with `bcryptjs` (cost ≥10). Never log credentials.
- Return minimal error messages for auth (avoid revealing whether email exists).

## Code Style
- Keep modules self-contained; re-use common utilities via `src/lib/`.
- No one-letter variable names.
- Avoid in-line comments; prefer self-documenting code.
- Keep exports minimal and typed.
