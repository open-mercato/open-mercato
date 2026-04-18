# Step 3.9 — Verification Checks

## Scope

Phase 1 WS-C third Step: ship the customers read-only AI tool pack. Lives
inside `packages/core/src/modules/customers/ai-tools.ts` plus six
helper files under `packages/core/src/modules/customers/ai-tools/`. The
generator already scans every module root for an `ai-tools.ts`
contribution (Step 2.3 restored loader), so no generator plumbing is
required. All eleven tools are read-only; mutation tools for
deals/activities/tasks/addresses/tags are deferred to Phase 5 (Step
5.13+) under the pending-action contract.

Follows Step 3.8 (general-purpose packs) and unlocks Step 3.10 (catalog
pack) which will reuse this exact placement/test template.

## Files touched

Code commit:

- `packages/core/src/modules/customers/ai-tools.ts` (new) —
  module-root aggregator. Default/`aiTools` export concat of the six packs.
- `packages/core/src/modules/customers/ai-tools/types.ts` (new) — local
  `CustomersAiToolDefinition` shape + `assertTenantScope` helper. Mirrors
  the pattern already used by `packages/core/src/modules/inbox_ops/ai-tools.ts`
  so jest does not need a cross-package import into `@open-mercato/ai-assistant`.
- `packages/core/src/modules/customers/ai-tools/people-pack.ts` (new) —
  `customers.list_people`, `customers.get_person`.
- `packages/core/src/modules/customers/ai-tools/companies-pack.ts` (new) —
  `customers.list_companies`, `customers.get_company`.
- `packages/core/src/modules/customers/ai-tools/deals-pack.ts` (new) —
  `customers.list_deals`, `customers.get_deal`.
- `packages/core/src/modules/customers/ai-tools/activities-tasks-pack.ts` (new) —
  `customers.list_activities`, `customers.list_tasks`.
- `packages/core/src/modules/customers/ai-tools/addresses-tags-pack.ts` (new) —
  `customers.list_addresses`, `customers.list_tags`.
- `packages/core/src/modules/customers/ai-tools/settings-pack.ts` (new) —
  `customers.get_settings`.
- `packages/core/src/modules/customers/__tests__/ai-tools/shared.ts` (new)
  — shared `makeCtx` + `knownFeatureIds` test helpers.
- `packages/core/src/modules/customers/__tests__/ai-tools/people-pack.test.ts`
  (new) — 8 tests.
- `packages/core/src/modules/customers/__tests__/ai-tools/companies-pack.test.ts`
  (new) — 5 tests.
- `packages/core/src/modules/customers/__tests__/ai-tools/deals-pack.test.ts`
  (new) — 6 tests.
- `packages/core/src/modules/customers/__tests__/ai-tools/activities-tasks-pack.test.ts`
  (new) — 6 tests.
- `packages/core/src/modules/customers/__tests__/ai-tools/addresses-tags-pack.test.ts`
  (new) — 7 tests.
- `packages/core/src/modules/customers/__tests__/ai-tools/settings-pack.test.ts`
  (new) — 4 tests.
- `packages/core/src/modules/customers/__tests__/ai-tools/aggregator.test.ts`
  (new) — 2 tests (aggregator completeness + RBAC-features-in-acl audit).

Docs-flip commit: PLAN.md row 3.9, HANDOFF.md rewrite, NOTIFY.md append,
this file.

## Eleven read-only tools

| Tool | Input | `requiredFeatures` |
|------|-------|--------------------|
| `customers.list_people` | `{ q?, limit?<=100, offset?, tags?, companyId? }` | `customers.people.view` |
| `customers.get_person` | `{ personId, includeRelated? }` | `customers.people.view` |
| `customers.list_companies` | `{ q?, limit?<=100, offset?, tags? }` | `customers.companies.view` |
| `customers.get_company` | `{ companyId, includeRelated? }` | `customers.companies.view` |
| `customers.list_deals` | `{ q?, limit?<=100, offset?, personId?, companyId?, pipelineStageId?, status? }` | `customers.deals.view` |
| `customers.get_deal` | `{ dealId, includeRelated? }` | `customers.deals.view` |
| `customers.list_activities` | `{ personId?, companyId?, dealId?, activityType?, limit?, offset? }` | `customers.activities.view` |
| `customers.list_tasks` | `{ personId?, companyId?, dealId?, status?, limit?, offset? }` | `customers.activities.view` |
| `customers.list_addresses` | `{ entityType, entityId, limit?, offset? }` | `customers.activities.view` |
| `customers.list_tags` | `{ q?, limit?, offset? }` | `customers.activities.view` |
| `customers.get_settings` | `{}` | `customers.settings.manage` |

No tool carries `isMutation: true`. Every tool whitelists **existing**
feature IDs from `packages/core/src/modules/customers/acl.ts` (verified
by `aggregator.test.ts`). No new features invented.

### Feature ID mapping decisions

- **People / person detail** → `customers.people.view`
- **Companies / company detail** → `customers.companies.view`
- **Deals / deal detail** → `customers.deals.view`
- **Activities / tasks** → `customers.activities.view` (the only existing
  view feature covering both surfaces).
- **Addresses, tags** → `customers.activities.view`. The existing
  `/api/customers/addresses`, `/api/customers/tags`, and
  `/api/customers/todos` routes all guard `GET` on
  `customers.activities.view`, so the AI-tool least-privilege match is
  the same. (Flagged in the Blockers section below as a potential
  drive-by for a future spec; not a Step 3.9 blocker — we are mirroring
  the actual existing route contract verbatim.)
- **Settings** → `customers.settings.manage` (matches the existing
  `/api/customers/settings/address-format` route).

## Unit tests

```
cd packages/core && npx jest --config=jest.config.cjs --forceExit --testPathPatterns="customers/__tests__/ai-tools"
```

Result:

```
Test Suites: 7 passed, 7 total
Tests:       38 passed, 38 total
```

Full `packages/core` suite after the change:

```
cd packages/core && npx jest --config=jest.config.cjs --forceExit
Test Suites: 324 passed, 324 total
Tests:       2956 passed, 2956 total
```

Regression check against `packages/ai-assistant`:

```
cd packages/ai-assistant && npx jest --config=jest.config.cjs --forceExit
Test Suites: 25 passed, 25 total
Tests:       316 passed, 316 total
```

No regressions. Baseline preserved.

### Coverage areas

- **Tenant isolation** on the three list tools (people, companies, deals,
  activities, tasks, addresses, tags, settings). Mocked
  `findWithDecryption` returns a cross-tenant row; handler drops it and
  only the `tenant-1` row reaches the output.
- **Not-found / cross-tenant refusal** on the three detail tools
  (`get_person`, `get_company`, `get_deal`) — all return
  `{ found: false, <id> }` instead of throwing.
- **RBAC mandate**: `aggregator.test.ts` iterates every exported tool and
  asserts `requiredFeatures?.length > 0` and every feature exists in the
  module's own `acl.ts` `features` array.
- **100 page-size cap** on `list_people` / `list_companies` /
  `list_deals` / `list_activities` / `list_tasks` /
  `list_addresses` / `list_tags`. Zod `safeParse` rejects 101+.
- **`get_settings` output shape**: returns `pipelines`, `pipelineStages`,
  `dictionaries` (grouped by kind), and `addressFormat`. Cross-tenant
  dictionary rows dropped. Fallback to `line_first` when no settings row
  exists.
- **Missing tenant rejection** on at least one tool per pack — handler
  throws `Tenant context is required` before any DB call.
- **Empty-result short-circuit** on `list_deals` when `personId` yields
  zero matches — returns `{ items: [], total: 0 }` without calling
  `em.count`.

### Mocking strategy

- `@open-mercato/shared/lib/encryption/find` →
  `findWithDecryption` / `findOneWithDecryption` spies.
- `@open-mercato/shared/lib/crud/custom-fields` → `loadCustomFieldValues`
  spy (returns per-record custom-field map).
- `em.count` / `em.persistAndFlush` are jest mocks on the fake container.
- No ORM is booted; all tests run in jest's default node environment.

Raw `em.find(` / `em.findOne(` were verified not to appear in any of the
new non-test files (grep clean). Every query goes through
`findWithDecryption` / `findOneWithDecryption` with `tenantId` + (when
present) `organizationId` supplied both in `where` and in the scope tuple.

## Typecheck

```
yarn turbo run typecheck --filter=@open-mercato/core --filter=@open-mercato/app
```

- `@open-mercato/core:typecheck` — pass.
- `@open-mercato/app:typecheck` — same pre-existing diagnostics carried
  over from Step 3.1 / 3.8:
  - `agent-registry.ts(43,7)` — missing
    `@/.mercato/generated/ai-agents.generated` type declaration
    (runtime-guarded by try/catch).
  - Step 3.8 `ai-assistant/ai-tools/{search,attachments,meta}-pack.ts`
    handler variance errors against the existing `AiToolDefinition`
    generic. These are the same diagnostics present before Step 3.9.
- **Zero new diagnostics** on the new customers ai-tools files (verified
  by grepping the typecheck output for `customers/ai-tools`). The
  customers packs deliberately use a local
  `CustomersAiToolDefinition` shape (like `inbox_ops/ai-tools.ts`) so
  TS enforces full input-type narrowing inside each handler instead of
  relying on the ai-assistant generic.

## yarn generate

```
yarn generate
```

Succeeded in 6s. The generator now emits a new `customers` entry in
`apps/mercato/.mercato/generated/ai-tools.generated.ts` alongside
`search`, `ai_assistant`, `inbox_ops`:

```ts
import * as AI_TOOLS_customers_143 from "@open-mercato/core/modules/customers/ai-tools";
import * as AI_TOOLS_search_832 from "@open-mercato/search/modules/search/ai-tools";
import * as AI_TOOLS_ai_assistant_1218 from "@open-mercato/ai-assistant/modules/ai_assistant/ai-tools";
...
```

So the Phase 3 chat runtime (Step 2.3 loader) sees all eleven
customers tools at runtime without any additional wiring. No generator
code change was required.

The post-step `configs cache structural` purge reports as skipped
(pre-existing `@open-mercato/queue` export mismatch; same as Step 3.8;
unrelated). Noted for the record.

## OpenAPI / i18n / Playwright

Not applicable. No API routes, no user-facing strings, no UI surface.

## Notable design decisions

- **Placement inside `packages/core`.** The customers module is enabled
  by default in `apps/mercato/src/modules.ts`; the generator walks every
  enabled module, so adding a module-root `ai-tools.ts` inside customers
  needed **zero** generator changes. Each pack lives in its own
  `ai-tools/*.ts` file (under 350 lines each) so the aggregator stays
  trivially grep-able and future-split-friendly.
- **Local `CustomersAiToolDefinition` shape** instead of importing from
  `@open-mercato/ai-assistant`. This matches the existing
  `inbox_ops/ai-tools.ts` pattern and avoids adding a cross-package
  jest `moduleNameMapper` entry for `@open-mercato/ai-assistant` into
  `packages/core/jest.config.cjs`. The shape is a strict subset of
  `AiToolDefinition` from ai-assistant (additive superset safe), so
  the generator's structural loader accepts it unchanged.
- **Tenant isolation via `findWithDecryption` / `findOneWithDecryption`
  only.** Every query scopes by `tenantId` + (when set) `organizationId`
  in both the `where` map and the scope tuple, then post-filters by
  `row.tenantId === ctx.tenantId` as a defense in depth. Raw `em.find(`
  / `em.findOne(` appear nowhere in the new production files (grep
  verified pre-commit). `em.count` is used for total counts (it operates
  against MikroORM's ORM layer and does not bypass tenant scope because
  the same `where` is applied).
- **Detail tools emit `{ found: false }` instead of throwing** so a
  chat-mode agent can recover gracefully — matches the pattern Step 3.8
  established for `search.get_record_context` and
  `attachments.read_attachment`.
- **`includeRelated: true`** uses a single round of parallel
  `findWithDecryption` calls (addresses, activities, notes, tasks,
  interactions, tags, deals, people). Each related list is capped at
  100 rows. If a relation is trivially reachable but empty, an empty
  array is returned; the aggregate `related` object itself is `null`
  when `includeRelated` is omitted, so the caller can cheaply ask for
  the minimal shape and upgrade later.
- **`customers.list_tasks`** merges the canonical interactions surface
  (interactionType='task') and the legacy todo-links surface. The
  legacy read is skipped when a task status or deal filter is supplied
  because legacy todo links don't carry those facets. This matches the
  dual-surface reality of the customers domain today (SPEC-046b
  compatibility). Once todos fully migrate to interactions, this tool
  can drop the legacy branch.
- **`customers.get_settings`** intentionally pulls **all** dictionary
  kinds in one go (grouped by `row.kind`), because the spec's settings
  bullet explicitly lists "dictionaries" alongside pipelines / stages /
  address format. Individual kinds are keys of the returned
  `dictionaries` object; agents can filter client-side without a
  secondary round-trip.
- **Settings tool guarded by `customers.settings.manage`** to match the
  existing `/api/customers/settings/address-format` route.
- **No `isMutation` tools** in this Step, as the brief mandates. Mutation
  tools are Step 5.13+ scope under the pending-action contract.
- **No new feature IDs invented.** All eleven tools whitelist
  existing IDs from `customers/acl.ts` (verified by
  `aggregator.test.ts`).
- **No UI / no OpenAPI / no DB changes.** The Step is purely additive on
  the runtime surface, so BC checklists 7 (routes), 8 (DB), 10 (ACL
  feature IDs) are all no-op.

## BC impact

Additive only — per `BACKWARD_COMPATIBILITY.md`:

- **Surface 1 (Auto-discovery conventions)**: `ai-tools.ts` at module
  root is the already-documented convention. Adding another participant
  cannot break existing consumers.
- **Surface 2 (Types)**: no public type changed. The local
  `CustomersAiToolDefinition` shape is module-private and not exported
  from any package entry point.
- **Surface 3 (Function signatures)**: unchanged. No exported function
  changed.
- **Surface 5 (Event IDs)**: unchanged. This Step emits no events.
- **Surface 7 (API route URLs)**: unchanged.
- **Surface 8 (Database schema)**: unchanged.
- **Surface 10 (ACL feature IDs)**: unchanged — only existing IDs
  referenced; `aggregator.test.ts` enforces this at test time.
- **Surface 13 (Generated file contracts)**: the
  `ai-tools.generated.ts` export shape (`aiToolConfigEntries`,
  `allAiTools`) is unchanged; a new `customers` entry appears in the
  array, which is what Step 2.3 is designed to accept.

## Follow-up candidates (non-blocking)

- **Addresses / tags feature ID drift.** The existing routes guard
  `GET /api/customers/addresses`, `/api/customers/tags`,
  `/api/customers/todos` on `customers.activities.view`. That looks
  accidental — a future spec should introduce dedicated
  `customers.addresses.view` / `customers.tags.view` features. Step
  3.9 mirrors the current contract verbatim instead of introducing
  new feature IDs mid-implementation (brief mandates STOP on invented
  IDs). Flagged here so the follow-up spec can pick it up.
- **Query-engine parity.** Step 3.9 uses `findWithDecryption` directly
  because each tool is a small scoped list that does not need the
  query-engine's advanced filter merge surface. If future tool variants
  want custom-field filtering (`cf:*`), they should switch to the
  `queryEngine.query(...)` surface the existing people route uses.
- **`em.count`**. Currently invoked with the same `where` that
  `findWithDecryption` sees; MikroORM's `count` does not run the
  encryption subscriber because it returns scalars. That's safe today,
  but if a future encryption contract includes row-count awareness, the
  totals will need to flow through a shared helper.
