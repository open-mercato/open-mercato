# Execution plan — ephemeral env ignores placeholder JWT_SECRET

Issue: #6747

## Goal

`yarn mercato test:ephemeral` / `test:integration` boots even when `.env` was auto-copied from `.env.example` and carries the placeholder `JWT_SECRET`.

## Scope

- `packages/shared/src/lib/auth/jwt.ts`: export an `isUnsafeJwtSecret()` predicate built on the existing private `inspectSecret()`, so the placeholder list has one source of truth.
- `packages/cli/src/lib/testing/integration.ts`: add a `resolveEphemeralJwtSecret()` helper. It keeps a safe inherited `JWT_SECRET` and otherwise falls back to the runner default. Both env builders (reusable and fresh) use it.
- Unit tests for both.

## Non-goals

- Changing `.env.example`, the guard's placeholder list, or the `.env` auto-copy.
- `OM_SECURITY_MFA_SETUP_SECRET`: no placeholder guard exists for it today.

## Risks

- Low. Behavior changes only when the inherited secret would already have crashed the production-mode app. A real operator secret (as pinned in CI) is still honored.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Fix and tests

- [ ] 1.1 Export isUnsafeJwtSecret predicate from shared jwt with unit tests
- [ ] 1.2 Resolve ephemeral JWT_SECRET through the predicate in both env builders with unit tests
