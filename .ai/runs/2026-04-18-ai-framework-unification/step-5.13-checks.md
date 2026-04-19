# Step 5.13 — First mutation-capable agent flow — Checks

**Code commit:** `53cf4103b`
**Docs-flip commit:** _(this commit)_
**Branch:** `feat/ai-framework-unification`
**Worktree:** `/Users/piotrkarwatka/Projects/mercato-development` (documented dogfood exception)

## Files touched

### Created

- `packages/core/src/modules/customers/__tests__/ai-tools/deals-pack.mutation.test.ts`
  - 19 unit tests covering the new mutation tool:
    contract (isMutation, requiredFeatures, schema refinements),
    `loadBeforeRecord` (snapshot + cross-tenant + cross-org + tenant-missing guard),
    `handler` (commandBus delegation via `toPipelineStageId`, plain
    `toStage` flip, 404 when deal is cross-tenant, 404 when pipeline
    stage id is unknown).
- `packages/core/src/modules/customers/__integration__/TC-AI-MUTATION-011-deal-stage.spec.ts`
  - 5 Playwright tests locking in:
    GET / confirm / cancel routes wired behind auth with a structured
    JSON envelope for unknown ids (tolerant of whether the dev DB has
    Step 5.5's `ai_pending_actions` migration applied — accepts
    `pending_action_not_found` or the route-tagged `*_internal_error`);
    unauth returns 401/403 on all three verbs; end-to-end deal-PUT
    data contract (seed company + deal, flip `status: 'won'`, read
    back, tear down).

### Modified

- `packages/core/src/modules/customers/ai-tools/types.ts`
  - `CustomersToolLoadBeforeSingleRecord` added (prefix-compatible with
    `@open-mercato/ai-assistant`'s `AiToolLoadBeforeSingleRecord`).
  - `CustomersAiToolDefinition` grows optional `loadBeforeRecord`.
- `packages/core/src/modules/customers/ai-tools/deals-pack.ts`
  - New `updateDealStageTool`:
    `name: 'customers.update_deal_stage'`, `isMutation: true`,
    `requiredFeatures: ['customers.deals.manage']`, `tags: ['write', 'customers']`.
    `inputSchema`: `{ dealId: uuid, toPipelineStageId?: uuid, toStage?: string }`
    with exactly-one-of refinement.
    `loadBeforeRecord` snapshots `{ status, pipelineStage, pipelineStageId }`
    with `updatedAt.toISOString()` as `recordVersion`.
    `handler` delegates to the `customers.deals.update` command via
    `commandBus`; returns `{ recordId, commandName, before, after }`.
    Appended to the default-exported `dealsAiTools` array so the
    module-root aggregator picks it up.
- `packages/core/src/modules/customers/ai-agents.ts`
  - `ALLOWED_TOOLS` adds `customers.update_deal_stage`.
  - MUTATION POLICY prompt section updated to document the unlock path
    (per-tenant override) and the mutation-preview-card / result-card
    flow. `readOnly: true` / `mutationPolicy: 'read-only'` UNCHANGED.
- `packages/core/src/modules/customers/__tests__/ai-agents.test.ts`
  - `never whitelists a mutation tool` → `whitelists only the
    explicitly approved mutation tool(s)` (expects
    `customers.update_deal_stage` IN `allowedTools`, any other mutation
    tool OUT).
  - New assertions: `customers.update_deal_stage` is exposed with
    `isMutation: true`, uses `customers.deals.manage`; MUTATION POLICY
    section mentions the tool name.
- `packages/core/src/modules/customers/__tests__/ai-tools/aggregator.test.ts`
  - Expected-tool list grows the new name.
  - Assertion split: all tools declare `requiredFeatures` that exist in
    acl; read-only tools still do NOT set `isMutation`.

## Gate results

| Gate | Command | Result |
|------|---------|--------|
| Customers focused tests | `cd packages/core && npx jest --config=jest.config.cjs --forceExit --testPathPatterns="customers/.*(ai-agents\|ai-tools/(deals\|aggregator))"` | **4 suites / 46 tests** (19 new + 27 prior) |
| Full core tests | `cd packages/core && npx jest --config=jest.config.cjs --forceExit` | **339 suites / 3114 tests** (baseline 338/3094 preserved; +1 suite / +20 tests for the new mutation tool coverage) |
| ai-assistant tests | `cd packages/ai-assistant && npx jest --config=jest.config.cjs --forceExit` | **47/525 preserved** |
| ui tests | `cd packages/ui && npx jest --config=jest.config.cjs --forceExit` | **65/348 preserved** |
| Typecheck | `yarn turbo run typecheck --filter=@open-mercato/core --filter=@open-mercato/ai-assistant --filter=@open-mercato/app` | **clean** (core rebuilt; app/ai-assistant cached or gated by build) |
| Generator | `yarn generate` | **clean**; `ai-tools.generated.ts` re-exports the customers module-root bundle so the new tool is picked up |
| i18n sync | `yarn i18n:check-sync` | **all 4 locales in sync** (no new user-facing strings on the server) |
| Integration | `yarn test:integration --grep="TC-AI-MUTATION-011"` | **5 passed** (GET/confirm/cancel wiring + unauth + deal PUT data contract) |

## Unit suite coverage matrix — new mutation tool

| Case | Assertion |
|------|-----------|
| Tool flag | `isMutation === true` |
| Required feature | `requiredFeatures` contains `customers.deals.manage` and every entry exists in `acl.ts` |
| Load resolver present | `typeof loadBeforeRecord === 'function'` |
| Input: bad UUID | `dealId: 'not-a-uuid'` fails schema |
| Input: neither target | `{ dealId }` fails schema (exactly-one-of refinement) |
| Input: both targets | `{ dealId, toPipelineStageId, toStage }` fails |
| Input: toStage only | passes |
| Input: toPipelineStageId only | passes |
| loadBeforeRecord happy | returns `{ recordId, entityType: 'customers.deal', recordVersion: updatedAt.toISOString(), before: { status, pipelineStage, pipelineStageId } }` |
| loadBeforeRecord missing deal | returns `null` |
| loadBeforeRecord cross-tenant | returns `null` |
| loadBeforeRecord cross-org | returns `null` when caller is org-scoped |
| loadBeforeRecord no tenantId | throws `Tenant context is required for customers.* tools` |
| Handler: pipeline stage flip | `commandBus.execute('customers.deals.update', { input: { id, tenantId, organizationId, pipelineStageId }, ctx: auth/org scoped })` |
| Handler: status flip | same but with `{ status }` instead of `{ pipelineStageId }` |
| Handler: cross-tenant | throws `not accessible`; commandBus NOT called |
| Handler: unknown stage id | throws `Pipeline stage "<id>" not found`; commandBus NOT called |
| Handler: returns `{ recordId, commandName, before, after }` | checked via handler output shape |

## Integration suite coverage matrix — TC-AI-MUTATION-011

| Case | Assertion |
|------|-----------|
| GET `/api/ai_assistant/ai/actions/:id` unknown id (auth) | 404 `pending_action_not_found` OR 500 `internal_error` (DB tolerant) |
| POST `.../confirm` unknown id (auth) | 404 `pending_action_not_found` OR 500 `confirm_internal_error` |
| POST `.../cancel` unknown id (auth) | 404 `pending_action_not_found` OR 500 `cancel_internal_error` |
| All three verbs without auth | 401/403 |
| Deal PUT data contract | seed company + deal → PUT `{ id, status: 'won' }` → 200 → GET returns `status: 'won'` → cleanup |

## Decisions / blockers

- **(a) Command delegation path:** the existing `customers.deals.update`
  command already accepts `status` and `pipelineStageId` via
  `dealUpdateSchema` — no new handler or PATCH-route shim needed. The
  tool calls `commandBus.execute('customers.deals.update', ...)` with a
  synthesized `AuthContext` (`sub = ctx.userId ?? 'ai-agent'`,
  `tenantId`, `orgId`) and a minimal `CommandRuntimeContext`. All
  downstream side effects (audit log, `customers.deal.updated` event,
  query index refresh, notification emission) reuse the existing
  command's code paths exactly.
- **(b) Pipeline-stage enum source:** pipeline stages are
  tenant-scoped rows in `CustomerPipelineStage`; there is NO hard-coded
  enum. The tool accepts `toPipelineStageId` (UUID pointing at the
  stage row, preferred when the deal belongs to a managed pipeline)
  OR `toStage` (free-form string mapped onto `CustomerDeal.status` for
  pipeline-less deals — `open` / `won` / `lost` and friends). The
  `dealUpdateSchema` already enforces `status.max(50)` and
  `pipelineStageId.uuid()`, so no extra server-side validation was
  needed. Falling back to `z.string().min(1)` with server-side
  validation (the spec's contingency) was not required.
- **(c) Event emission:** `customers.deal.updated` already existed in
  `events.ts` and is emitted by the update command's
  `emitCrudSideEffects` call. Zero-touch — the tool inherits emission
  automatically. The DataTable DOM event bridge picks it up for the
  deals-grid refresh.
- **(d) Feature-id gap:** none. `customers.deals.manage` is the
  existing write-path feature (matches the PUT route's
  `requireFeatures`). No new feature id added.
- **Full chat-SSE walk deferred:** seeding an `AiPendingAction` row
  directly from the Playwright test would require either a test-only
  endpoint (forbidden by the brief) or a new live-DB helper that
  imports the Step 5.5 repo. Neither fits the one-Step scope. The full
  walk (preview-card render → confirm POST → handler invoke →
  result-card render) moves to Step 5.17 alongside the reconnect +
  idempotency coverage already listed for that Step.
- **Dev DB tolerance:** the live dev DB at port 3000 is missing Step
  5.5's `Migration20260419134235_ai_assistant` (the dispatcher was not
  authorized to run `yarn db:migrate`). The integration spec accepts
  both the happy-path `404 pending_action_not_found` and the
  schema-gap `500 *_internal_error` envelopes so it passes regardless
  of the migration state.

## BC posture

- **Additive only.** One new tool in the customers pack; the agent's
  `allowedTools` gained one entry; the prompt template's MUTATION
  POLICY section grew explanatory text (prompt sections are not a BC
  contract surface). `CustomersAiToolDefinition` gained an OPTIONAL
  `loadBeforeRecord` field — existing tool definitions continue to
  type-check without change. No DB migration, no event id rename, no
  API route moved, no DI registration renamed. The agent's
  code-declared `readOnly: true` / `mutationPolicy: 'read-only'` flags
  are untouched.

## Hard-rule deviations

None.
