# Step 5.5 — Phase 3 WS-C foundation verification notes

**Commit (code):** `26c467112`
**Branch:** `feat/ai-framework-unification`
**Date:** 2026-04-19 UTC

## Summary

Opened Phase 3 WS-C by landing the persistent store that backs the
mutation-approval gate (spec §8 `AiPendingAction` + §9 confirm/cancel
flow). One new additive table (`ai_pending_actions`), one new entity,
one new repository, one new shared-types module, no changes to
existing tables or routes. Steps 5.6 → 5.14 consume this store.

## Unit tests

One new suite; every pre-existing suite remains green.

| Suite | Tests | Notes |
|-------|-------|-------|
| `data/repositories/__tests__/AiPendingActionRepository.test.ts` | 8 | happy-path create (status=pending, TTL-derived `expiresAt`, `attachmentIds` default `[]`, `queueMode='inline'`); idempotent-while-pending (same id returned on re-create); idempotent-after-terminal (new id on re-create after `cancelled`); illegal-transition rejection (`confirmed → pending` and `confirmed → cancelled` → `AiPendingActionStateError`); `setStatus('expired')` stamps `resolvedAt`, nulls `resolvedByUserId`; `listExpired` tenant-isolation + `limit` cap + `status='pending' AND expiresAt < now` filter; `getById` tenant-scoped (other tenant → `null`); `listPendingForAgent` filters by agent + tenant + status. |

### Counts

- `@open-mercato/ai-assistant`: **37 / 427** (baseline 36 / 419 → +1 / +8).
- `@open-mercato/core`: **338 / 3094** (baseline preserved).
- `@open-mercato/ui`: **60 / 328** (baseline preserved).

## Typecheck

`yarn turbo run typecheck --filter=@open-mercato/ai-assistant --filter=@open-mercato/core --filter=@open-mercato/app --force`
→ **all 2 typecheck tasks green** (`@open-mercato/core` + `@open-mercato/app`;
ai-assistant has no typecheck script — its Jest suite + ts-jest acts as
the TS gate, which passed above).

## Generators

- `yarn generate` — green, zero drift. The new entity flows through the
  existing `ai_assistant_*` aggregate import paths; no new namespace.
- `cd packages/ai-assistant && node build.mjs` — clean rebuild so the
  generator can resolve the compiled import.
- `touch apps/mercato/next.config.ts` — applied (Turbopack cache recipe).

## Migration

`yarn db:generate` — emits
`packages/ai-assistant/src/modules/ai_assistant/migrations/Migration20260419134235.ts`.
Class name manually suffixed with `_ai_assistant` to match the Step 5.3 /
5.4 convention (generator emits the bare date-timestamp class and logs an
unrelated `rename failed` warning). Shape:

```sql
create table "ai_pending_actions" (
  "id" uuid not null default gen_random_uuid(),
  "tenant_id" uuid not null,
  "organization_id" uuid null,
  "agent_id" text not null,
  "tool_name" text not null,
  "conversation_id" text null,
  "target_entity_type" text null,
  "target_record_id" text null,
  "normalized_input" jsonb not null,
  "field_diff" jsonb not null default '[]',
  "records" jsonb null,
  "failed_records" jsonb null,
  "side_effects_summary" text null,
  "record_version" text null,
  "attachment_ids" jsonb not null default '[]',
  "idempotency_key" text not null,
  "created_by_user_id" uuid not null,
  "status" text not null,
  "queue_mode" text not null default 'inline',
  "execution_result" jsonb null,
  "created_at" timestamptz not null,
  "expires_at" timestamptz not null,
  "resolved_at" timestamptz null,
  "resolved_by_user_id" uuid null,
  constraint "ai_pending_actions_pkey" primary key ("id")
);
create index "ai_pending_actions_tenant_org_agent_status_idx"
  on "ai_pending_actions" ("tenant_id", "organization_id", "agent_id", "status");
create index "ai_pending_actions_tenant_org_status_expires_idx"
  on "ai_pending_actions" ("tenant_id", "organization_id", "status", "expires_at");
alter table "ai_pending_actions"
  add constraint "ai_pending_actions_tenant_org_idempotency_uq"
  unique ("tenant_id", "organization_id", "idempotency_key");
```

`down()` issues `drop table if exists ... cascade`. Reversible.

Snapshot: `packages/ai-assistant/src/modules/ai_assistant/migrations/.snapshot-open-mercato.json`
— updated alongside the migration. Out-of-scope drift in
`business_rules` / `catalog` / `shipping_carriers` emitted during
`yarn db:generate` was reverted so the PR stays scoped.

Grep confirmation (manual read of the emitted migration file):

- one `create table "ai_pending_actions"` statement,
- three index / constraint creation statements matching the spec indexes:
  - `ai_pending_actions_tenant_org_agent_status_idx`,
  - `ai_pending_actions_tenant_org_status_expires_idx`,
  - `ai_pending_actions_tenant_org_idempotency_uq` (unique).

## i18n

`yarn i18n:check-sync` → **all translation files in sync** across
en / pl / es / de. No new keys added in this Step (pure data layer).

## Key decisions

- **Idempotency-after-terminal behavior (confirmed per brief).** Second
  `create` with the same `(tenantId, organizationId, idempotencyKey)`
  after any terminal status mints a NEW row with a new id. Double-submit
  during the TTL window while still pending remains a no-op returning
  the existing row. Matches spec §8 `idempotencyKey prevents double-
  submission ... within the TTL`.
- **TTL env variable (confirmed per brief).** `AI_PENDING_ACTION_TTL_SECONDS`,
  default `900` (15 minutes). The spec §8 mentions `expiresAt defaults
  to 10 minutes ... overridable per agent (mutationApprovalTtlMs)`;
  per-agent override is a carry-forward for Step 5.6+, the env var is
  the system-wide default. Follows the `<MODULE>_AI_MODEL` precedent
  from Step 5.1 — internal convention, no `.env.example` update.
- **`records` vs `fieldDiff` invariant (confirmed per brief).** When
  `records[]` is present (batch actions per spec §9.8), the per-record
  entries are authoritative and the top-level `fieldDiff` is ignored
  by the route / confirm handler. Entity stores both because single-
  record flows keep using top-level `fieldDiff`. No runtime consumer
  yet — Step 5.6 will emit exactly one of the two shapes, Step 5.14
  (bulk catalog updates) will emit `records[]`.
- **State machine lives in the types module, not in the repo.** The
  allowed-transition map (`AI_PENDING_ACTION_ALLOWED_TRANSITIONS`) is
  exported from `lib/pending-action-types.ts` so the future route
  handlers (Steps 5.7 / 5.8 / 5.9) and the cleanup worker (Step 5.12)
  share one source of truth. The repo enforces it via
  `AiPendingActionStateError` in `setStatus`; the route layer turns
  that into a 409 Conflict response.
- **`attachmentIds` default `[]`.** The entity-level default matches
  the spec §8 rule `attachmentIds: string[]` (not nullable). Both
  the MikroORM `default: []` property and the migration's `jsonb
  not null default '[]'` back the invariant so seeded / legacy rows
  are well-formed.
- **`executing` is NOT terminal.** Spec §9.4 treats `executing` as a
  transient state between `confirmed` and the final `confirmed` /
  `failed` outcome. The state-machine map allows `executing →
  confirmed` (success preserves `status='confirmed'` and records
  `executionResult.recordId`) and `executing → failed`. No path
  allows `executing → pending` or `executing → cancelled`.

## BC

- Additive only. New entity, new table, new repo, new types module,
  new package-barrel exports. No existing surfaces modified.
- No import paths removed; no event IDs renamed; no database columns
  dropped. No existing repository signatures changed.

## Integration tests

None in this Step. Routes land in 5.7 / 5.8 / 5.9; the integration
suite for the pending-action contract is Step 5.17's responsibility.
This Step is the pure data-layer foundation — unit tests cover
tenant isolation, state-machine enforcement, and idempotency.
