# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-18T20:30:00Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
coordinator `in-progress` lock — main session is the dispatcher; the
executor MUST NOT release the lock)
**Current phase/step:** Phase 3 WS-C — Steps 3.7, 3.8, 3.9 landed. Next
up is Step 3.10 (catalog base tool pack).
**Last commit:** `c2f2e21cb` —
`feat(customers): add customers ai-tool pack (read-only Phase 1)`

## What just happened

- Executor landed **Step 3.9** as one code commit (`c2f2e21cb`) plus
  this docs-flip commit (PLAN row + HANDOFF rewrite + NOTIFY append +
  step-3.9-checks.md).
- Eleven new read-only tools shipped under
  `packages/core/src/modules/customers/ai-tools/`:
  - `people-pack.ts` — `customers.list_people`, `customers.get_person`.
  - `companies-pack.ts` — `customers.list_companies`,
    `customers.get_company`.
  - `deals-pack.ts` — `customers.list_deals`, `customers.get_deal`.
  - `activities-tasks-pack.ts` — `customers.list_activities`,
    `customers.list_tasks`.
  - `addresses-tags-pack.ts` — `customers.list_addresses`,
    `customers.list_tags`.
  - `settings-pack.ts` — `customers.get_settings`.
- Plus a `types.ts` declaring the local `CustomersAiToolDefinition`
  shape (subset of the canonical `AiToolDefinition`, identical pattern
  to `inbox_ops/ai-tools.ts` — avoids adding a cross-package jest
  `moduleNameMapper` entry into `packages/core/jest.config.cjs`).
- Module-root `ai-tools.ts` aggregates all six packs via `aiTools` /
  `default`. The existing generator (Step 2.3) discovers the customers
  module and emits a new
  `@open-mercato/core/modules/customers/ai-tools` namespace entry in
  `apps/mercato/.mercato/generated/ai-tools.generated.ts` — zero
  generator changes required.
- Tenant isolation: every query routes through `findWithDecryption` /
  `findOneWithDecryption` with `tenantId` + (when set)
  `organizationId` in both the `where` map and the scope tuple, plus
  a defense-in-depth post-filter (`row.tenantId === ctx.tenantId`).
  Pre-commit grep confirms no raw `em.find(` / `em.findOne(` in any of
  the new production files.
- Policy + ACL: every tool whitelists the **minimum existing** feature
  ID from `customers/acl.ts`:
  - people → `customers.people.view`.
  - companies → `customers.companies.view`.
  - deals → `customers.deals.view`.
  - activities / tasks / addresses / tags → `customers.activities.view`
    (matches what the actual existing routes enforce on `GET` today —
    noted as a future-spec follow-up in step-3.9-checks.md).
  - settings → `customers.settings.manage`.
- No mutation tools. Every tool is explicitly read-only; mutations
  for deals / activities / tasks / addresses / tags are deferred to
  Phase 5 under the pending-action contract (Step 5.13+).
- Detail tools emit `{ found: false }` instead of throwing on miss /
  cross-tenant / cross-org — matches Step 3.8's pattern.
- New unit-test suites at
  `packages/core/src/modules/customers/__tests__/ai-tools/`:
  - `people-pack.test.ts` (8 tests).
  - `companies-pack.test.ts` (5 tests).
  - `deals-pack.test.ts` (6 tests).
  - `activities-tasks-pack.test.ts` (6 tests).
  - `addresses-tags-pack.test.ts` (7 tests).
  - `settings-pack.test.ts` (4 tests).
  - `aggregator.test.ts` (2 tests — completeness + RBAC-in-acl audit).
  Plus a shared `shared.ts` helper with `makeCtx` + `knownFeatureIds`
  pulled from `customers/acl.ts`.
- Unit tests: **7 suites / 38 tests** in
  `packages/core/src/modules/customers/__tests__/ai-tools/`. Full core
  suite: **324 suites / 2956 tests** passing. Ai-assistant regression:
  **25 suites / 316 tests** (baseline preserved).
- Typecheck:
  `yarn turbo run typecheck --filter=@open-mercato/core --filter=@open-mercato/app`
  — same pre-existing Step 3.8 diagnostics (ai-assistant handler
  variance on `search/attachments/meta` packs + Step 3.1 carryover
  `agent-registry.ts(43,7)`). Zero new diagnostics on the new
  customers files (verified by grepping the typecheck output).
- `yarn generate` — required for this Step (new module-root
  `ai-tools.ts`). Generator ran in 6s and emitted the `customers` entry
  correctly. Post-step `configs cache structural` purge reports as
  skipped (pre-existing `@open-mercato/queue` export mismatch,
  unrelated to this Step; same as Step 3.8).

## Next concrete action

- **Step 3.10** — Spec Phase 1 WS-C — Catalog tool pack (base
  coverage: products / categories / variants / prices / offers / media
  / product configuration).
  - Live under `packages/core/src/modules/catalog/ai-tools.ts` (or a
    split `ai-tools/*.ts` directory + root aggregator — Step 3.8 / 3.9
    pattern is the proven template). The generator already scans
    `packages/core` module roots.
  - Spec reference §512–§520 for the catalog pack surface — the
    D18 demo needs the base read tools landed first before Step 3.11
    (D18 merchandising read) can layer on top.
  - All tools read-only in Phase 1. `isMutation` must stay `false`
    unless the spec explicitly lists a mutation, in which case flag the
    Step for a split.
  - Use the catalog query engine / services (pricing service, offers
    service, etc.); MUST keep every query tenant+org scoped via
    `findWithDecryption` / `findOneWithDecryption` or go through
    existing services — no raw `em.find(` / `em.findOne(`.
  - Follow the Step 3.9 local-type pattern (`CatalogAiToolDefinition`
    inside the catalog module) if the cross-package jest mapping is
    still unwired.
  - Unit tests per tool: tenant scope, RBAC feature filtering (use an
    `aggregator.test.ts`-style pass over `catalog/acl.ts` features),
    page-size cap, and at least one shape check per detail tool.
- After 3.10 come the D18 catalog merchandising read + AI-authoring
  tools (3.11, 3.12), then Step 3.13 closes WS-C with integration
  coverage for auth / attachment / tool filtering.

## Blockers / open questions

- **`packages/ai-assistant` typecheck script**: still missing — same
  caveat as earlier Steps.
- **`apps/mercato` stale generated import**: `agent-registry.ts(43,7)`
  still references `@/.mercato/generated/ai-agents.generated` which is
  not emitted yet (Step 3.1 carryover). Runtime try/catch hides it;
  TS flags it as a compile-time diagnostic. Drive-by candidate for any
  future Step that touches ai-agents generator output.
- **Step 3.8 handler-variance diagnostics**: `search-pack.ts`,
  `attachments-pack.ts`, `meta-pack.ts` under ai-assistant still carry
  the Step 3.8 assignment-variance errors from the public
  `AiToolDefinition` generic (`handler(input: unknown, …)` vs. the
  narrowed inferred types). Not my Step, not introduced by Step 3.9 —
  they pre-exist on the branch. A future Step that touches the public
  `AiToolDefinition` generic can either relax the parameter variance
  or add a `defineAiTool` overload that widens the handler input back
  to `unknown`.
- **Addresses / tags feature ID drift**. Existing routes guard
  `GET /api/customers/addresses` and `/api/customers/tags` on
  `customers.activities.view`. Looks accidental. Step 3.9 mirrors the
  current contract verbatim because inventing new feature IDs
  mid-implementation would violate the brief's STOP rule. Flagged in
  step-3.9-checks.md Follow-ups so a future spec can introduce
  dedicated `customers.addresses.view` / `customers.tags.view`
  features and migrate routes + tools together.
- **`search.get_record_context` strategy** (Step 3.8 carryover). A
  future first-class `SearchService.getRecordContext({ entityId,
  recordId })` helper would let the tool drop the current 5-item scan.
- **Attachment transfer duplication** (Step 3.8 carryover). If Step
  5.x extracts the assignments-patch logic into a service, the
  `attachments.transfer_record_attachments` tool becomes a thin
  wrapper.
- **`AttachmentSigner` concrete implementation**: still not shipped
  (Step 3.7 hook only). Oversized images/PDFs still fall through to
  `metadata-only`. Flag persists.
- **Object-mode HTTP dispatcher**: still deferred to Phase 4.
- **Tools in object mode**: still the Step 3.5 gap — AI SDK v6 object
  entries don't accept a `tools` map. Policy gate still runs on the
  resolved tools, but they are not forwarded to
  `generateObject` / `streamObject`. Migration to `generateText` +
  `Output.object` stays a Phase 4 candidate.
- **User's unstaged spec edit** (~280 lines on
  `.ai/specs/2026-04-11-unified-ai-tooling-and-subagents.md`) still
  out-of-scope.
- **`authContext` on the public helper surface**: intentional Phase-1
  shim on both helpers. Phase 4 may wrap them behind a thinner API
  once a global request-context resolver lands.

## Environment caveats

- Dev runtime runnable: unknown. Phase 3 remains runtime + tests only.
- Database/migration state: clean, untouched.
- `yarn generate` — re-run in Step 3.9 (new module-root `ai-tools.ts`
  in `packages/core/src/modules/customers`). Step 3.10 (catalog) will
  likely need it again when we add `ai-tools.ts` to the catalog module.

## Worktree

- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's
  primary worktree — documented dogfood exception).
