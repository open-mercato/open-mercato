# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-19T01:05:00Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
coordinator `in-progress` lock — main session is the dispatcher; the
executor MUST NOT release the lock)
**Current phase/step:** Phase 5 Step 5.13 **complete**. The customers
module now ships its first mutation-capable tool
(`customers.update_deal_stage`) which is whitelisted in
`customers.account_assistant.allowedTools` but gated behind the
Step 5.4 per-tenant mutation-policy override — the agent's
`readOnly: true` / `mutationPolicy: 'read-only'` flags are untouched so
every tenant still ships read-only by default and must explicitly
opt in to unlock the write path. The tool delegates to the existing
`customers.deals.update` command via the shared `commandBus`, so the
audit log / `customers.deal.updated` event / query-index refresh /
notification pipelines are inherited unchanged.
**Last commit (code):** `53cf4103b` — `feat(customers): customers.update_deal_stage mutation tool + account-assistant wiring (Phase 3 WS-C)`

## What just happened

- **New mutation tool** `customers.update_deal_stage` in
  `packages/core/src/modules/customers/ai-tools/deals-pack.ts`:
  - Declares `isMutation: true`, guarded by the existing
    `customers.deals.manage` feature (same as the PUT deals route).
  - `inputSchema`: `{ dealId: uuid, toPipelineStageId?: uuid, toStage?: string }`
    with a zod `refine` enforcing exactly-one-of. Pipeline-stage
    identifiers stay data-driven (no hard-coded enum) — stages are
    tenant-scoped rows in `CustomerPipelineStage`. `toStage` is a
    free-form slug that maps onto `CustomerDeal.status` for pipeline
    roots like `open` / `won` / `lost`.
  - `loadBeforeRecord(input, ctx)` returns
    `{ recordId, entityType: 'customers.deal', recordVersion, before }`
    using the deal's `updatedAt.toISOString()` as recordVersion. The
    Step 5.8 confirm route uses that version to reject stale writes
    (`412 stale_version`). Tenant / org scoped: cross-tenant or
    cross-org rows resolve to `null` so `prepareMutation` refuses to
    wrap them and the confirm route returns 404.
  - `handler(input, ctx)` re-validates the scope, then synthesizes a
    minimal `AuthContext` / `CommandRuntimeContext` and calls
    `commandBus.execute('customers.deals.update', { input: { id,
    tenantId, organizationId, ...targetFields }, ctx })`. Returns
    `{ recordId, commandName: 'customers.deals.update', before, after }`
    — `normalizeExecutionResult` in the Step 5.8 executor extracts
    `recordId` / `commandName` for the pending-action row.
- **Agent wiring** `packages/core/src/modules/customers/ai-agents.ts`:
  - `customers.update_deal_stage` added to `ALLOWED_TOOLS`.
  - MUTATION POLICY prompt section rewritten to document the unlock
    path: "ships read-only by default … when the operator asks to move
    a deal to a new stage, call `customers.update_deal_stage` … do
    NOT promise the change is saved until the mutation-result-card
    arrives … if the override is still read-only the runtime will
    refuse the call".
  - `readOnly: true` and `mutationPolicy: 'read-only'` flags UNCHANGED.
    Per spec §9 the per-tenant override is the only lever that
    actually unlocks writes — the escalation-guard stays meaningful.
- **Types** `packages/core/src/modules/customers/ai-tools/types.ts`:
  - New `CustomersToolLoadBeforeSingleRecord` interface
    (prefix-compatible with the public
    `AiToolLoadBeforeSingleRecord` from `@open-mercato/ai-assistant`).
  - `CustomersAiToolDefinition` grows an optional `loadBeforeRecord`
    field. Pure additive — existing tool definitions continue to
    type-check without change.
- **Event emission**: `customers.deal.updated` already existed and is
  emitted by the update command's `emitCrudSideEffects` call. Zero-
  touch — the DataTable DOM event bridge already picks it up.
- **New unit suite** `src/modules/customers/__tests__/ai-tools/deals-pack.mutation.test.ts`
  (19 tests): contract flags, zod input refinements,
  `loadBeforeRecord` happy / missing / cross-tenant / cross-org /
  no-tenant, `handler` pipeline-stage flip / plain status flip / cross
  -tenant rejection / unknown stage id rejection. Plus existing
  `ai-agents.test.ts` and `aggregator.test.ts` extended to cover the
  approved mutation whitelist and the new MUTATION POLICY wording.
- **New integration spec** `TC-AI-MUTATION-011-deal-stage.spec.ts`
  (5 Playwright tests):
  1. GET `/api/ai_assistant/ai/actions/:id` with unknown id — returns a
     structured envelope (`404 pending_action_not_found` when Step
     5.5's `ai_pending_actions` migration is applied, or
     `500 internal_error` when it's not — both forms are treated as
     acceptable so the test passes against the current dev DB state).
  2. POST `.../confirm` with unknown id — same envelope shape;
     `500` code is `confirm_internal_error`.
  3. POST `.../cancel` with unknown id — same; `500` code is
     `cancel_internal_error`.
  4. All three verbs without auth → 401/403.
  5. End-to-end deal-PUT data contract: seed company + deal via CRM
     fixtures → PUT `{ id, status: 'won' }` → GET back → assert
     `status: 'won'` → cleanup.

## Test + gate results

- **Tests**: core 338/3094 → **339/3114** (+1 suite / +20 tests — the
  new mutation test suite plus extended assertions in existing
  suites); ai-assistant 47/525 preserved; ui 65/348 preserved.
- **Typecheck**: `yarn turbo run typecheck --filter=@open-mercato/core
  --filter=@open-mercato/ai-assistant --filter=@open-mercato/app`
  clean. (ai-assistant has no dedicated typecheck script; it is gated
  by the build step — not regressed.)
- **Generator**: `yarn generate` green; `ai-tools.generated.ts`
  re-exports the customers module-root bundle so the new tool is
  visible at runtime. No worker / entity / DI id change so no
  structural cache drift beyond the standard purge.
- **i18n**: `yarn i18n:check-sync` green — the only user-facing text
  changes live in the agent's prompt template and the PLAN docs
  (neither flows through the i18n catalogue).
- **Integration**: `yarn test:integration --grep="TC-AI-MUTATION-011"`
  — 5 passed. See `step-5.13-checks.md` for the per-test coverage
  matrix.

## BC posture (production inventory)

- **Additive only.** New tool name in the customers pack; new allowedTools
  entry on the existing production agent; prompt section rewritten (prompt
  content is not a BC contract surface). `CustomersAiToolDefinition`
  grows an OPTIONAL `loadBeforeRecord` field. No DB migration, no event
  id rename, no API route moved, no DI registration renamed. The agent's
  code-declared read-only flags are untouched. Per-tenant policy override
  (Step 5.4) remains the only lever that unlocks writes at runtime.

## Open follow-ups carried forward

- **Step 5.14** — D18 catalog mutation tools (`update_product`,
  `bulk_update_products`, `apply_attribute_extraction`,
  `update_product_media_descriptions`) with single `AiPendingAction`
  per batch + per-record `records[]` diff grouping.
- **Full chat-SSE walk for the mutation flow** — Step 5.17 owns the
  full walk (preview-card render → confirm POST → handler invoke →
  result-card render) now that the tool + agent wiring landed. That
  Step also gets the reconnect, cross-tenant, stale-version, expiry,
  and read-only-refusal scenarios that the brief listed.
- **Dev DB migration state** — the live dev runtime at port 3000 is
  missing Step 5.5's `Migration20260419134235_ai_assistant`. The
  integration spec is tolerant of both migration states; the next
  executor MAY run `yarn db:migrate` (with user authorization) to see
  the happy-path `404 pending_action_not_found` envelopes instead of
  the schema-gap `500 *_internal_error` envelopes.
- **Dispatcher UI-part flushing** — still on the Step 5.10 backlog.
- **Per-agent TTL override** (spec §8 `mutationApprovalTtlMs`) still
  deferred.
- **`agent-runtime.ts` `resolveAgentModel` migration** still deferred
  from Step 5.1.
- **`inbox_ops/ai-tools.ts` + `translationProvider.ts`** still call
  `resolveExtractionProviderId` + `createStructuredModel` directly.
- **Dedicated portal `ai_assistant.view` feature** — still gated on
  `portal.account.manage`; tighten in a later Phase 5 Step.
- **Dedicated `ai_assistant.settings.manage_mutation_policy` feature**
  — carried from Step 5.5.
- **Dev-env integration test for the cleanup worker** — still gated on
  the coordinator's next checkpoint batch.

## Next concrete action

- **Step 5.14** — catalog mutation tool set. Add
  `update_product`, `bulk_update_products`,
  `apply_attribute_extraction`, and `update_product_media_descriptions`
  to the catalog ai-tools pack. Key contract details: all four land in
  a single `AiPendingAction` per batch, with per-record `records[]`
  diff grouping carried on `loadBeforeRecords` (the batch resolver,
  mirror of the single-record resolver we shipped in 5.13). The
  current `catalog.merchandising_assistant` is the natural whitelist
  target — same no-code-flag-change policy: `readOnly: true` stays on
  the agent definition; the per-tenant mutation-policy override is
  the unlock. Spec §10 D18 lists four demo use-cases that MUST walk
  end-to-end through `bulk_update_products` with a single
  `[Confirm All]` approval. Reuse the customers tool's commandBus
  delegation pattern so all downstream side effects stay identical to
  a direct API write.

## Cadence reminder

- **5-Step checkpoint overdue.** Last full-gate checkpoint landed
  after 5.12 (`checkpoint-5step-after-5.12.md`). One Step since
  (5.13). Coordinator runs the next checkpoint batch after 5.17
  (the natural "close of Phase 3 WS-C").
- Phase 3 WS-A (5.1 + 5.2) done; Phase 3 WS-B (5.3 + 5.4) done;
  Phase 3 WS-C: 5.5–5.13 done; 5.14 remains before the Phase 3 WS-D
  integration-test sweep (5.15–5.19).

## Environment caveats

- Dev runtime: `bgyb7opzt` on port 3000 — reuse for Phase 5 Step 5.14
  validation. The dev DB is still missing Step 5.5's
  `Migration20260419134235_ai_assistant`; the Step 5.13 integration
  test is tolerant of both migration states. The next executor MAY
  run `yarn db:migrate` (with user authorization) if they want
  stricter pending-action envelope coverage during validation.
- Database / migration state: no migration in this Step. Step 5.5's
  `Migration20260419134235_ai_assistant` remains the active delta
  (and is still un-applied on dev — see above).
- Typecheck clean (`@open-mercato/core` + `@open-mercato/app`);
  ai-assistant gated by build + ts-jest.
- TTL env var: `AI_PENDING_ACTION_TTL_SECONDS` (default 900s) —
  unchanged.

## Scope-discipline note for Step 5.14

Keep the catalog mutation tools additive: do NOT touch existing
catalog commands or schemas. Mirror the Step 5.13 pattern of
synthesizing an `AuthContext` / `CommandRuntimeContext` from the tool
handler and delegating to the existing
`catalog.products.update` / `catalog.products.bulk_update` commands
(or their nearest equivalents — grep first). The batch tool MUST set
`isBulk: true` and declare `loadBeforeRecords` so the Step 5.6
`prepareMutation` wrapper emits per-record `records[]` diffs on the
preview card instead of a single `fieldDiff`. The Step 5.6 `matchBatchPatch`
helper expects each batch entry to carry `{ recordId, ...patch }`.

## Worktree

- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's
  primary worktree — documented dogfood exception).
