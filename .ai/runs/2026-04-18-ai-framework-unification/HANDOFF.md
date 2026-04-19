# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-19T15:45:00Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
coordinator `in-progress` lock — main session is the dispatcher; the
executor MUST NOT release the lock)
**Current phase/step:** Phase 5 Step 5.5 **complete**. The `AiPendingAction`
persistent store (entity + migration + repository + types module) has
landed; Phase 3 WS-C is now unblocked. Next: Step 5.6 — `prepareMutation`
runtime wrapper that intercepts `isMutation: true` tool calls for
non-read-only agents, creates a pending action via the new repo, and
emits the `mutation-preview-card` UI part.
**Last commit (code):** `26c467112` — `feat(ai-assistant): AiPendingAction entity + repository + migration (Phase 3 WS-C foundation)`

## What just happened

- New MikroORM entity `AiPendingAction` appended to
  `packages/ai-assistant/src/modules/ai_assistant/data/entities.ts`
  (+ by-name re-export at `data/entities/AiPendingAction.ts`).
  Migration landed at
  `packages/ai-assistant/src/modules/ai_assistant/migrations/Migration20260419134235.ts`
  (reversible; `down()` drops the table cascade). Snapshot updated.
- Column set matches the spec §8 `AiPendingAction` type exactly:
  `id`, `tenantId`, `organizationId`, `agentId`, `toolName`,
  `conversationId`, `targetEntityType`, `targetRecordId`,
  `normalizedInput` (jsonb), `fieldDiff` (jsonb, default `'[]'`),
  `records` (jsonb, nullable — batch shape, authoritative when set),
  `failedRecords` (jsonb, nullable — populated by confirm handler for
  partial success), `sideEffectsSummary`, `recordVersion`,
  `attachmentIds` (jsonb, default `'[]'`), `idempotencyKey`,
  `createdByUserId`, `status`, `queueMode` (default `'inline'`;
  `'stack'` reserved for D17), `executionResult` (jsonb, nullable),
  `createdAt`, `expiresAt`, `resolvedAt`, `resolvedByUserId`.
- Indexes landed:
  - `(tenant_id, organization_id, status, expires_at)` — cleanup
    worker (Step 5.12) scans on this.
  - `(tenant_id, organization_id, agent_id, status)` — list-active-
    pending-per-agent UI queries (future settings page / inbox badge).
  - Unique `(tenant_id, organization_id, idempotency_key)` — dedupe
    per tenant-org bucket (spec §8 index guidance).
- Types module `lib/pending-action-types.ts` consolidates:
  - `AiPendingActionStatus` enum (`pending | confirmed | cancelled |
    expired | executing | failed`) + `AI_PENDING_ACTION_STATUSES`
    constant tuple for runtime validation.
  - `AiPendingActionQueueMode` enum + constant tuple.
  - `AI_PENDING_ACTION_ALLOWED_TRANSITIONS` state-machine map.
  - `AiPendingActionStateError` (thrown by `setStatus` on illegal
    transitions; routes turn this into 409).
  - `AI_PENDING_ACTION_DEFAULT_TTL_SECONDS = 900` +
    `AI_PENDING_ACTION_TTL_ENV_VAR = 'AI_PENDING_ACTION_TTL_SECONDS'`
    + `resolveAiPendingActionTtlSeconds(env)` helper.
  - Re-exported from `@open-mercato/ai-assistant` so Steps 5.6–5.14
    share one source of truth.
- Repository `AiPendingActionRepository` exposes:
  - `create(input, ctx)` → inserts `status='pending'`, stamps
    `expiresAt = now + TTL`. Idempotent while pending: same
    `(tenantId, organizationId, idempotencyKey)` returns the existing
    row unchanged. Once the prior row hits any terminal status
    (`cancelled | expired | failed | confirmed`), the same key mints
    a NEW row with a new id. This is the contract Step 5.6's
    `prepareMutation` consumes.
  - `getById(id, ctx)` → tenant-scoped; cross-tenant reads return
    `null`.
  - `listPendingForAgent(agentId, ctx, limit=50)` — for the future
    settings-page "open actions" surface and the 4.5 agent detail
    panel badge.
  - `setStatus(id, nextStatus, ctx, extra?)` — enforces the state
    machine. Invalid transitions throw `AiPendingActionStateError`.
    Stamps `resolvedAt` on terminal transitions; `expired` forces
    `resolvedByUserId = null`. Accepts optional `executionResult` /
    `failedRecords` payloads that the Step 5.8 confirm handler will
    surface.
  - `listExpired(ctx, now, limit=100)` — for the Step 5.12 cleanup
    worker. Returns only `status='pending' AND expiresAt < now`,
    ordered by `expiresAt asc`, tenant-scoped.
  - All reads go through `findOneWithDecryption` /
    `findWithDecryption`. All writes scope by `tenantId` + nullable
    `organizationId`.
- TTL env variable: `AI_PENDING_ACTION_TTL_SECONDS`, default `900`
  (15 minutes). Matches the Step 5.5 brief. The spec §8 guidance
  (10 min default) will become a per-agent override
  (`mutationApprovalTtlMs`) in a later Step; the env var is the
  system-wide floor today.
- Idempotency-after-terminal behavior (the Step 5.5 brief asked for
  explicit confirmation): **new-row-new-id** on second create after
  any terminal status. Same-tenant double-submit during the TTL
  window remains a no-op (returns the existing pending row). This
  matches spec §8 rule `idempotencyKey prevents double-submission;
  re-calling prepareMutation with the same key within the TTL returns
  the same id` — once the window closes (via any terminal status),
  a fresh action is legitimate.
- `records` vs `fieldDiff` invariant: when `records[]` is present
  (batch actions per spec §9.8), the per-record entries are
  authoritative and the top-level `fieldDiff` is ignored by the
  route / confirm handler. The entity stores both because single-
  record flows still use top-level `fieldDiff`. Step 5.6 will emit
  exactly one of the two forms; Step 5.14 (bulk catalog updates)
  will emit `records[]`. No runtime consumer yet — this Step is the
  foundation only.
- Unit tests — 8 new cases in
  `data/repositories/__tests__/AiPendingActionRepository.test.ts`:
  happy-path create, idempotent-while-pending, idempotent-after-
  terminal (new id), illegal-transition rejection (`confirmed →
  pending`, `confirmed → cancelled`), `expired` stamps `resolvedAt`
  and nulls `resolvedByUserId`, `listExpired` tenant-isolation +
  `limit` cap, `getById` cross-tenant null, `listPendingForAgent`
  filters by agent + tenant + status.
- Test deltas:
  - ai-assistant: 36 / 419 → **37 / 427** (+1 suite / +8 tests).
  - core: 338 / 3094 preserved.
  - ui: 60 / 328 preserved.
- Typecheck (`@open-mercato/ai-assistant` [Jest + ts-jest],
  `@open-mercato/core`, `@open-mercato/app`) green;
  `yarn generate` zero drift; `yarn db:generate` emitted the
  migration (class renamed to `_ai_assistant` suffix to match the
  Step 5.3 / 5.4 convention — generator emits the bare
  date-timestamp class and logs an unrelated `rename failed`
  warning); `yarn i18n:check-sync` green (no new keys in this Step).
- Out-of-scope drift in business_rules / catalog / shipping_carriers
  emitted during `yarn db:generate` was reverted so the PR stays
  scoped.

## Open follow-ups carried forward

- **Step 5.6** is the next natural stop: `prepareMutation` runtime
  wrapper. It sits in the agent-runtime's tool-call dispatch path,
  intercepts `isMutation: true` tools for agents whose effective
  policy is not `read-only`, calls
  `AiPendingActionRepository.create(...)` with a deterministic
  `idempotencyKey` derived from `{ tenant, agent, conversation, tool,
  normalizedInput hash }`, and emits a `mutation-preview-card` UI
  part to the chat stream. Routes (5.7 / 5.8 / 5.9) consume the
  resulting row.
- **Per-agent TTL override.** Spec §8 mentions
  `mutationApprovalTtlMs` overridable per agent. Today the repo
  honors only the env-level TTL. Step 5.6 or a later Step should
  surface the per-agent override through `AiAgentDefinition` and
  pass it to `create({ ttlSeconds })`.
- **`agent-runtime.ts` `resolveAgentModel` migration** still deferred
  from Step 5.1. A later Step should migrate it to
  `createModelFactory(container)` so chat-mode and object-mode runs
  honor `<MODULE>_AI_MODEL` via the shared port.
- **Runtime signature extension** for `AiAgentPageContextInput` —
  the merchandising agent's sheet already carries
  `pageContext.extra.filter` client-side, but the current hook only
  forwards `entityType` + `recordId`. When a Step needs the filter
  server-side (e.g., the D18 bulk-edit flow), widen the shape
  additively and re-wire the merchandising hydrator to surface it.
- **`inbox_ops/ai-tools.ts` + `translationProvider.ts`** still call
  `resolveExtractionProviderId` + `createStructuredModel` directly.
  Revisit in or after the next WS-C Step.
- **Portal customer login UI helper** still missing from
  `packages/core/src/modules/core/__integration__/helpers/` — carried
  from Phase 2. TC-AI-INJECT-010 retains its deferred-UI-smoke
  placeholder.
- **Dedicated portal `ai_assistant.view` feature** — still gated on
  `portal.account.manage`; tighten in a later Phase 5 Step.
- **Dedicated `ai_assistant.settings.manage_mutation_policy` feature**
  — Step 5.4 shipped the mutation-policy UI under the existing
  `ai_assistant.settings.manage` feature (same as prompt overrides).
  Splitting it out remains optional and would be additive.

## Next concrete action

- **Step 5.6** — Spec Phase 3 WS-C — `prepareMutation` runtime
  wrapper. Intercepts `isMutation: true` tools for agents whose
  effective `mutationPolicy` is not `read-only`, calls
  `AiPendingActionRepository.create(...)` with a stable
  `idempotencyKey`, and emits a `mutation-preview-card` UI part on
  the chat stream. Exit criteria: unit tests for the wrapper +
  idempotency-in-flight + policy gate (read-only agents never
  reach the wrapper). No routes yet — those land in 5.7 / 5.8 / 5.9.

## Cadence reminder

- **5-Step checkpoint overdue.** Last full-gate checkpoint landed
  after 4.4 (`checkpoint-5step-after-4.4.md`); Phase 2 closed at 4.11;
  Steps 5.1–5.5 are the 7th–11th Steps since. Main coordinator should
  run the full validation gate + integration suites + ds-guardian
  sweep BEFORE Step 5.6 wires the runtime into the new store.
- Phase 3 WS-A (5.1 + 5.2) done; Phase 3 WS-B (5.3 + 5.4) done;
  Phase 3 WS-C opens at 5.5 (this Step) and continues through 5.14.

## Environment caveats

- Dev runtime: `bgyb7opzt` on port 3000 — reuse for Phase 5 Step 5.6
  validation.
- Database / migration state: **new migration landed this Step**
  (`Migration20260419134235_ai_assistant`). Snapshot checked in.
  Run `yarn db:migrate` to apply on any env that lagged.
- Typecheck clean (`@open-mercato/core` + `@open-mercato/app`); the
  ai-assistant package still has no `typecheck` script — its Jest
  suite acts as the TS gate via `ts-jest`.
- TTL env var: `AI_PENDING_ACTION_TTL_SECONDS` (default 900). No
  `.env.example` update in this Step (internal convention — matches
  the `<MODULE>_AI_MODEL` precedent from Step 5.1).

## Worktree

- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's
  primary worktree — documented dogfood exception).
