# Atomic Password Change + Audit Event — Execution Plan

**Date:** 2026-04-24
**Slug:** `atomic-password-change-and-audit-event`
**Branch:** `fix/atomic-password-change-and-audit-event`
**Motivated by:** Follow-up review observations from PR #1686 (`fix(security): revoke customer sessions on self-service password change`).

## Goal

Two related hardening improvements to customer password-change handlers:

1. **Transactional atomicity** — wrap `customerUserService.updatePassword(...)` + `customerSessionService.revokeAllUserSessions(...)` in a single MikroORM transaction so a revoke failure rolls back the password write. Today, if revoke fails after the password is persisted, sessions linger.
2. **Audit event emission** — declare a new typed event `customer_accounts.password.changed` in the `customer_accounts` module's `events.ts` and emit it from all three password-change handlers **after** the transaction commits (so rollback does not emit).

## Scope

### In-scope files

- `packages/core/src/modules/customer_accounts/events.ts` — declare `customer_accounts.password.changed`.
- `packages/core/src/modules/customer_accounts/services/customerUserService.ts` — accept optional `EntityManager` param for `updatePassword`.
- `packages/core/src/modules/customer_accounts/services/customerSessionService.ts` — accept optional `EntityManager` param for `revokeAllUserSessions`.
- `packages/core/src/modules/customer_accounts/api/portal/password-change.ts` — wrap in transaction, emit event.
- `packages/core/src/modules/customer_accounts/api/password/reset-confirm.ts` — wrap in transaction, emit event.
- `packages/core/src/modules/customer_accounts/api/admin/users/[id]/reset-password.ts` — wrap in transaction, keep existing `password.reset` event, additionally emit `password.changed`.
- `packages/core/src/modules/customer_accounts/api/portal/__tests__/password-change.route.test.ts` — extend with new invariants.
- `packages/core/src/modules/customer_accounts/api/password/__tests__/reset-confirm.route.test.ts` — new test file.
- `packages/core/src/modules/customer_accounts/api/admin/users/[id]/__tests__/reset-password.route.test.ts` — new test file.

### Non-goals

- No subscriber for the new event (declaration + emission only).
- No DB schema changes.
- No changes to other handlers that call `updatePassword` or `revokeAllUserSessions`.
- No UI changes.
- No refactor of existing `password.reset` event (admin route continues emitting it for BC).

## Event payload shape

```ts
'customer_accounts.password.changed': {
  userId: string,
  tenantId: string,
  organizationId: string | null,
  changedBy: 'self' | 'admin' | 'reset',
  changedById: string | null,
  at: string  // ISO8601
}
```

- `self` → portal self-service (`password-change.ts`)
- `reset` → magic-link reset confirm (`reset-confirm.ts`)
- `admin` → admin-initiated reset (`admin/users/[id]/reset-password.ts`)
- `changedById`: admin actor id when `changedBy === 'admin'`; `null` otherwise.

## Transaction pattern

Services currently hold a reference to the scoped `em`. MikroORM v7 `em.transactional(cb)` forks the em internally; operations on the outer em are NOT in the transaction. To avoid invasive DI restructuring, add an **optional** `em?: EntityManager` parameter to the two mutating service methods. Inside a handler, resolve services from the container (preserves existing test mocks), then:

```ts
const em = container.resolve('em') as EntityManager
await em.transactional(async (trx) => {
  await customerUserService.updatePassword(user, newPassword, trx)
  await customerSessionService.revokeAllUserSessions(user.id, trx)
})
// Emit event AFTER the transaction commits; a rollback must not emit.
await emitCustomerAccountsEvent('customer_accounts.password.changed', { ... })
```

Short-circuit checks (missing auth, invalid body, wrong current password, user not found) stay OUTSIDE the transaction.

## External References

None — no `--skill-url` passed. Guidance derived from root `AGENTS.md` (PR workflow, conventional commits, full gate) and `packages/core/AGENTS.md` (events, transactions, BC).

## Risks

- **BC on service signatures:** Adding a trailing optional param to `updatePassword` / `revokeAllUserSessions` is additive. Per `BACKWARD_COMPATIBILITY.md` category #3 ("Function signatures" — STABLE, new optional params OK), this is permitted.
- **Event-emission TypeScript compile:** `emitCustomerAccountsEvent` is typed off the `as const` array. Adding a new entry is additive.
- **Admin route emits two events:** `customer_accounts.password.reset` (existing, keep for BC) + `customer_accounts.password.changed` (new). Any existing subscribers on `.reset` are unaffected.
- **Reset-confirm handler currently does not look up the user object** — only has `{ userId, tenantId }` from the token. We need `organizationId` for the new event, so the handler will do a single `customerUserService.findById(userId, tenantId)` after token verification. This is a tiny extra query and not a contract change.

## Implementation Plan

### Phase 1: Declare the audit event

- 1.1 Add `customer_accounts.password.changed` to the events array in `events.ts` with `label: 'Customer Password Changed'`, `category: 'lifecycle'`. No broadcast flags (audit event).
- 1.2 Run `yarn generate` so the typed emit surface picks up the new id.

### Phase 2: Make service methods transaction-aware

- 2.1 Add optional `em?: EntityManager` to `CustomerUserService.updatePassword` — when provided, use it instead of `this.em`.
- 2.2 Add optional `em?: EntityManager` to `CustomerSessionService.revokeAllUserSessions` — when provided, use it instead of `this.em`.

### Phase 3: Wire portal `password-change.ts`

- 3.1 Resolve `em` from the container, wrap the two mutating calls in `em.transactional(...)`, emit `customer_accounts.password.changed` with `changedBy: 'self'` after commit.
- 3.2 Extend `password-change.route.test.ts`:
  - Happy-path event emission with full payload.
  - Revoke-failure rollback: when `revokeAllUserSessions` throws, the handler returns 5xx and the event is NOT emitted.
  - Event NOT emitted on short-circuits (wrong current password, missing auth, missing user, validation failure).
- 3.3 Preserve all 6 pre-existing invariants from PR #1686.

### Phase 4: Wire `reset-confirm.ts`

- 4.1 After token verification, look up the user via `customerUserService.findById(result.userId, result.tenantId)` to obtain `organizationId`.
- 4.2 Wrap the `updatePassword` + `revokeAllUserSessions` pair in `em.transactional(...)`. Leave the existing `emailVerifiedAt` native update outside the transaction (pre-existing behavior, out of scope to tighten here).
- 4.3 Emit `customer_accounts.password.changed` with `changedBy: 'reset'` after commit.
- 4.4 Create `reset-confirm.route.test.ts` pinning: happy-path emission, rollback-on-revoke-failure (no emission), no emission on invalid token / validation failure.

### Phase 5: Wire admin `reset-password.ts`

- 5.1 Wrap the two mutating calls in `em.transactional(...)`.
- 5.2 Keep the existing `customer_accounts.password.reset` emission (BC) AND add `customer_accounts.password.changed` with `changedBy: 'admin'`, `changedById: auth.sub`.
- 5.3 Create `reset-password.route.test.ts` pinning: happy-path both events emitted, rollback-on-revoke-failure emits NEITHER event, no emission on 401/403/404/validation short-circuits.

### Phase 6: Full validation gate + PR

- 6.1 Run: `yarn build:packages`, `yarn generate`, `yarn build:packages` (post-generate), `yarn i18n:check-sync`, `yarn i18n:check-usage`, `yarn typecheck`, `yarn test`, `yarn build:app`.
- 6.2 Self code-review (`.ai/skills/code-review/SKILL.md`) + BC self-review (`BACKWARD_COMPATIBILITY.md`).
- 6.3 Open PR against `develop`, apply `security` + `needs-qa` labels.
- 6.4 Run `auto-review-pr` in autofix mode; iterate until clean or only non-actionable findings remain.
- 6.5 Post comprehensive summary comment, flip `Status:` to `complete`, clean up worktree.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Declare the audit event

- [x] 1.1 Add `customer_accounts.password.changed` to events.ts — d56779fc1
- [x] 1.2 Run yarn generate — d56779fc1

### Phase 2: Make service methods transaction-aware

- [ ] 2.1 Add optional em param to CustomerUserService.updatePassword
- [ ] 2.2 Add optional em param to CustomerSessionService.revokeAllUserSessions

### Phase 3: Wire portal password-change.ts

- [ ] 3.1 Wrap mutations in em.transactional and emit event
- [ ] 3.2 Extend password-change.route.test.ts
- [ ] 3.3 Verify pre-existing invariants still pass

### Phase 4: Wire reset-confirm.ts

- [ ] 4.1 Look up user to obtain organizationId
- [ ] 4.2 Wrap mutations in em.transactional
- [ ] 4.3 Emit event with changedBy: 'reset'
- [ ] 4.4 Add reset-confirm.route.test.ts

### Phase 5: Wire admin reset-password.ts

- [ ] 5.1 Wrap mutations in em.transactional
- [ ] 5.2 Emit password.changed alongside existing password.reset
- [ ] 5.3 Add reset-password.route.test.ts

### Phase 6: Full validation gate + PR

- [ ] 6.1 Run full validation gate
- [ ] 6.2 Self code-review + BC self-review
- [ ] 6.3 Open PR with labels
- [ ] 6.4 Run auto-review-pr autofix loop
- [ ] 6.5 Post summary comment, flip Status to complete
