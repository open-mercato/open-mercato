# Step 3.8 — Verification Checks

## Scope

Phase 1 WS-C second Step: ship the three general-purpose AI tool packs
(`search.*`, `attachments.*`, `meta.*`) as a new module-root
`ai-tools.ts` inside `packages/ai-assistant`, so the existing generator
(Step 2.3) picks them up through the single aggregated
`ai-tools.generated.ts` pipeline without any new generator plumbing.

Follows Step 3.7 attachment bridge; unlocks Step 3.9 customers tool
pack which reuses the same placement pattern.

## Files touched

Code commit (`11c5a87b8`):
- `packages/ai-assistant/src/modules/ai_assistant/ai-tools.ts` (new) — module-root aggregator re-exporting all three packs via `aiTools` / `default`.
- `packages/ai-assistant/src/modules/ai_assistant/ai-tools/search-pack.ts` (new) — `search.hybrid_search`, `search.get_record_context`.
- `packages/ai-assistant/src/modules/ai_assistant/ai-tools/attachments-pack.ts` (new) — `attachments.list_record_attachments`, `attachments.read_attachment`, `attachments.transfer_record_attachments` (uses dynamic `import()` for `@open-mercato/core/modules/attachments/**` to match the Step 3.7 bridge pattern and avoid a hard cross-package dep).
- `packages/ai-assistant/src/modules/ai_assistant/ai-tools/meta-pack.ts` (new) — `meta.list_agents`, `meta.describe_agent`.
- `packages/ai-assistant/src/modules/ai_assistant/ai-tools/__tests__/search-pack.test.ts` (new) — 9 tests.
- `packages/ai-assistant/src/modules/ai_assistant/ai-tools/__tests__/attachments-pack.test.ts` (new) — 13 tests.
- `packages/ai-assistant/src/modules/ai_assistant/ai-tools/__tests__/meta-pack.test.ts` (new) — 9 tests.

Docs-flip commit (this turn): PLAN.md row 3.8, HANDOFF.md rewrite, NOTIFY.md append, this file.

No changes to `@open-mercato/ai-assistant/src/index.ts` — the packs are
discovered through the generator, not through the package entry point,
matching how `@open-mercato/search` and `@open-mercato/core/inbox_ops`
already contribute.

## Unit tests

```
cd packages/ai-assistant && npx jest --config=jest.config.cjs --forceExit
```

Result:

```
Test Suites: 25 passed, 25 total
Tests:       316 passed, 316 total
```

Delta vs Step 3.7 baseline (22/285): **+3 suites, +31 tests**. None
skipped.

### Coverage areas

- `search.hybrid_search`: tenant+org scope propagation, default limit 20,
  strategy whitelist, missing-tenant rejection.
- `search.get_record_context`: matching-hit happy, miss (`{ found: false }`),
  tenant-scope propagation, missing-tenant rejection.
- `attachments.list_record_attachments`: metadata-only items, empty
  record, tenant scope, missing-tenant rejection, no URL / signed URL in
  output (bytes live on the Step 3.7 bridge).
- `attachments.read_attachment`: extracted text only when
  `includeExtractedText: true`, `{ found: false }` on cross-tenant miss,
  always-scoped `where`.
- `attachments.transfer_record_attachments`: `isMutation: true`, persists
  via `em.persistAndFlush`, updates assignments metadata, rejects
  cross-entity transfers, honors tenant+org scope, zero-match returns
  `transferred: 0` without flushing.
- `meta.list_agents`: empty-registry graceful return, RBAC feature
  filtering, super-admin bypass, `moduleId` filter.
- `meta.describe_agent`: `not_found`, `forbidden`, happy with Zod →
  JSON-Schema conversion, non-serializable schema fallback, dynamic-page-
  context flag.

### Mocking strategy

- `@open-mercato/shared/lib/encryption/find` → spies for
  `findWithDecryption` / `findOneWithDecryption`.
- `@open-mercato/core/modules/attachments/data/entities` → stub
  `Attachment` class.
- `@open-mercato/core/modules/attachments/lib/metadata` →
  pure-function stubs for `readAttachmentMetadata` and
  `mergeAttachmentMetadata` so the handler logic is exercised without
  pulling in the core module at test time.

All encryption scope args pass through the handler; raw `em.find(` /
`em.findOne(` never appear in the production files (verified via grep).

## Typecheck

```
yarn turbo run typecheck --filter=@open-mercato/core --filter=@open-mercato/app
```

- `@open-mercato/core:typecheck` — cache hit, pass.
- `@open-mercato/app:typecheck` — one pre-existing diagnostic only (Step
  3.1 carryover: `agent-registry.ts(43,7)` missing
  `@/.mercato/generated/ai-agents.generated`, guarded by the runtime
  try/catch). No new diagnostics on any of the new tool files or the
  module-root aggregator.

## yarn generate

```
yarn generate
```

Succeeded in 6s. The `ai-tools.generated.ts` now lists the new
`ai_assistant` entry alongside the existing `search` and `inbox_ops`
contributions:

```ts
import * as AI_TOOLS_search_831 from "@open-mercato/search/modules/search/ai-tools";
import * as AI_TOOLS_ai_assistant_1217 from "@open-mercato/ai-assistant/modules/ai_assistant/ai-tools";
import * as AI_TOOLS_inbox_ops_1287 from "@open-mercato/core/modules/inbox_ops/ai-tools";
```

So the Phase 3 chat runtime (Step 2.3 loader) sees all seven new tools
at runtime without any additional wiring. No generator code change was
required — the generator already scans every enabled module for a
module-root `ai-tools.ts`.

The post-step `configs cache structural` purge is reported as skipped by
the CLI (pre-existing `@open-mercato/queue` export mismatch, unrelated
to this Step). Noted here for the record; not a blocker.

## OpenAPI

Not applicable. This Step adds no API routes.

## i18n / Playwright

Not applicable. Library-only change, no user-facing strings, no UI.

## Notable design decisions

- **Placement inside `packages/ai-assistant` itself.** The `ai_assistant`
  module is already enabled in `apps/mercato/src/modules.ts`; the
  generator walks every enabled module, so adding a module-root
  `ai-tools.ts` inside ai-assistant needed **zero** generator changes.
  Each pack lives in its own `ai-tools/*.ts` file so the generated code
  stays stable and the packs are trivially grep-able.
- **Dotted tool names preserved.** The spec requires `pack.snake_case`
  (e.g. `search.hybrid_search`) and the existing Step 3.2 policy gate,
  Step 2.3 loader, and OpenCode HTTP server already accept dots — no
  downstream adapter demanded underscores. If a downstream consumer
  needs underscore variants, that's a downstream mapping concern, not
  a tool-identity change.
- **Tenant isolation via `findWithDecryption` / `findOneWithDecryption`.**
  Every attachment query scopes by `tenantId` and (when set)
  `organizationId`. No raw `em.find(` / `em.findOne(` in any new
  production file (grep verified pre-commit). This matches the Step 3.7
  bridge's contract and is what the spec mandates for Phase 3.
- **`meta.list_agents` empty-registry safety.** `listAgents()` already
  returns `[]` when `loadAgentRegistry` couldn't import the generated
  file (Step 3.1 behavior). The `meta.*` tools wrap those calls in a
  defensive `try/catch` so even a throw inside `listAgents` / `getAgent`
  degrades to `{ agents: [] }` or `{ agent: null, reason: 'not_found' }`
  — chat runtime never crashes because agent discovery is broken.
- **`meta.describe_agent` output serialization.** Zod schemas aren't
  portable over JSON, so the tool emits `output.jsonSchema` via
  `z.toJSONSchema(...)` when the schema is representable. When the
  conversion throws (Zod v4 explicitly refuses some shapes), the tool
  falls back to `{ schemaName, mode, note: 'non-serializable', error }`
  so the agent still learns *what* kind of output is declared even if
  the shape can't travel. `prompt.template` is not emitted — the spec's
  "zod output schemas and prompt templates are not serializable" rule
  requires the tool to surface `prompt.systemPrompt` plus a
  `hasDynamicPageContext` flag (fires when the agent ships a
  `resolvePageContext` callback); any actual rendered context is the
  runtime's job (Step 3.4 / 3.5 system prompt composition).
- **`search.get_record_context` strategy choice.** SearchService's empty
  query contract is undefined, so we call `searchService.search(recordId,
  …)` scoped to the single `entityId` and scan the first 5 hits for a
  `recordId` match. If a future search module adds a first-class
  `getRecordContext` helper, this tool can switch to it without changing
  the agent-facing contract. **Follow-up candidate**: add
  `getRecordContext({ entityId, recordId })` to `SearchService` under a
  new Step in Phase 3 or as a dedicated spec, then migrate this tool to
  the direct call and drop the 5-item scan. Not blocking Phase 1.
- **Transfer tool reuses the same business rule as
  `/api/attachments/transfer`.** Metadata patching logic matches the
  existing route — assignments get their `id` rewritten for matching
  `(type, previousRecordId)` pairs, then the entire row is flushed via
  `em.persistAndFlush`. The Step brief asked us not to duplicate logic
  inline; since the route handler keeps the logic inside its own POST
  function and there is no exposed service yet, the minimum-risk path
  was to mirror the small loop verbatim (it's ~15 lines) while still
  routing the query through `findWithDecryption` instead of raw
  `em.find`. If Step 5.x extracts this into a service, this tool becomes
  a thin wrapper.
- **No new feature IDs invented.** All `requiredFeatures` are existing
  IDs: `search.view`, `attachments.view`, `attachments.manage`,
  `ai_assistant.view`.
- **No UI / no OpenAPI / no DB changes.** The Step is purely additive on
  the runtime surface, so BC checklists 7 (routes), 8 (DB), 10 (ACL
  feature IDs) are all no-op.

## BC impact

Additive only — per `BACKWARD_COMPATIBILITY.md`:
- **Surface 1 (Auto-discovery conventions)**: `ai-tools.ts` at module
  root is the already-documented convention. Adding another participant
  cannot break existing consumers.
- **Surface 2 (Types)**: no public type changed. Tool objects conform
  to the existing `AiToolDefinition` shape and use `defineAiTool()`
  (Step 2.1 helper).
- **Surface 3 (Function signatures)**: unchanged. No exported function
  changed.
- **Surface 5 (Event IDs)**: unchanged. This Step emits no events.
- **Surface 7 (API route URLs)**: unchanged.
- **Surface 8 (Database schema)**: unchanged.
- **Surface 10 (ACL feature IDs)**: unchanged — only existing IDs
  referenced.
- **Surface 13 (Generated file contracts)**: the
  `ai-tools.generated.ts` export shape (`aiToolConfigEntries`,
  `allAiTools`) is unchanged; a new entry appears in the array, which
  is what Step 2.3 is designed to accept.
