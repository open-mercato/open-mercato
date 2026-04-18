# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-18T19:45:00Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
coordinator `in-progress` lock — main session is the dispatcher; the
executor MUST NOT release the lock)
**Current phase/step:** Phase 3 WS-C — Step 3.7 (attachment bridge) and
Step 3.8 (general-purpose tool packs) landed. Next up is Step 3.9
(customers tool pack).
**Last commit:** `11c5a87b8` —
`feat(ai-assistant): add general-purpose tool packs (search, attachments, meta)`

## What just happened

- Executor landed **Step 3.8** as one code commit (`11c5a87b8`) plus
  this docs-flip commit (PLAN row + HANDOFF rewrite + NOTIFY append +
  step-3.8-checks.md).
- Three new general-purpose tool packs live under
  `packages/ai-assistant/src/modules/ai_assistant/ai-tools/`:
  - `search-pack.ts` — `search.hybrid_search`,
    `search.get_record_context`.
  - `attachments-pack.ts` — `attachments.list_record_attachments`,
    `attachments.read_attachment`,
    `attachments.transfer_record_attachments` (the single mutation
    tool, `isMutation: true`).
  - `meta-pack.ts` — `meta.list_agents`, `meta.describe_agent`.
- A new module-root `ai-tools.ts` aggregates them via `aiTools` /
  `default` exports. The existing generator (Step 2.3) discovers the
  `ai_assistant` module and emits the new
  `@open-mercato/ai-assistant/modules/ai_assistant/ai-tools` namespace
  entry in `apps/mercato/.mercato/generated/ai-tools.generated.ts`
  alongside `search` and `inbox_ops` — zero generator changes.
- Tenant isolation: every attachments query routes through
  `findWithDecryption` / `findOneWithDecryption` with `tenantId` +
  (when set) `organizationId`; no raw `em.find(` / `em.findOne(` in
  production files (grep verified pre-commit). The transfer tool
  persists through `em.persistAndFlush` after mutating loaded rows.
- Policy + ACL: every tool whitelists the **minimum** existing
  feature ID from the target module's `acl.ts` — `search.view`,
  `attachments.view`, `attachments.manage` (transfer only),
  `ai_assistant.view`. No new features invented.
- `meta.*` safety: both tools wrap the registry calls in defensive
  try/catch, so an empty or missing `ai-agents.generated.ts` yields
  `{ agents: [] }` / `{ agent: null, reason: 'not_found' }` — the
  chat runtime never crashes because agent discovery is broken.
  `meta.list_agents` filters through `hasRequiredFeatures(...)` so
  callers only see agents they can invoke; super-admin bypasses.
  `meta.describe_agent` emits `output.jsonSchema` via
  `z.toJSONSchema(...)` when representable, falls back to
  `{ note: 'non-serializable', error }` when the schema is refused.
  The prompt template exposes `systemPrompt` plus a
  `hasDynamicPageContext` boolean — it never executes a live
  `resolvePageContext` callback.
- Dotted tool names preserved (`search.hybrid_search` etc.) — the
  Step 3.2 policy gate, Step 2.3 loader, and OpenCode server already
  accept dots. No downstream adapter demanded underscore renaming;
  flagged in step-3.8-checks.md in case one surfaces later.
- New unit-test suites under `ai-tools/__tests__/`:
  `search-pack.test.ts`, `attachments-pack.test.ts`,
  `meta-pack.test.ts`. 31 new tests covering happy path, empty,
  missing-tenant, RBAC filtering, super-admin bypass, cross-entity
  transfer rejection, mutation-flag propagation, and the
  `z.toJSONSchema` fallback for non-serializable output schemas.
- Unit tests: 25 suites / 316 tests in `packages/ai-assistant`
  (baseline 22/285 after Step 3.7; delta **+3 suites, +31 tests**).
- Typecheck:
  `yarn turbo run typecheck --filter=@open-mercato/core --filter=@open-mercato/app`
  — still only the pre-existing
  `agent-registry.ts(43,7)` diagnostic (Step 3.1 carryover, guarded
  by runtime try/catch). No new diagnostics.
- `yarn generate` — required for this Step because it adds a new
  module-level `ai-tools.ts`. Generator ran in 6s and emitted the
  `ai_assistant` entry correctly. The post-step `configs cache
  structural` purge reports as skipped (pre-existing
  `@open-mercato/queue` export mismatch, unrelated to this Step).

## Next concrete action

- **Step 3.9** — Spec Phase 1 WS-C — Customers tool pack (people /
  companies / deals / activities / tasks / addresses / tags /
  settings).
  - Live under
    `packages/core/src/modules/customers/ai-tools.ts` (or break out
    into `ai-tools/*.ts` files with a root aggregator — Step 3.8
    pattern is a proven template). The generator already scans
    `packages/core` module roots.
  - Spec reference §495–§509 for the customers pack surface —
    enumerate tools before implementing to pin the exact names and
    input schemas.
  - Use the customers module's existing query engine / commands
    surface for reads; MUST keep every query tenant+org scoped via
    `findWithDecryption` / `findOneWithDecryption` or go through the
    existing services — no raw `em.find(` / `em.findOne(`.
  - All tools read-only in Phase 1 (mutations arrive in Phase 5 via
    the pending-action gate). `isMutation` must stay `false` unless
    the spec explicitly lists a mutation, in which case flag the
    Step for a split.
  - Unit tests per tool: tenant scope, RBAC feature filtering, shape
    of the returned record (presenter / links / custom fields).
- After 3.9 come the catalog packs (3.10–3.12), then Step 3.13
  closes WS-C with integration coverage for auth / attachment / tool
  filtering.

## Blockers / open questions

- **`packages/ai-assistant` typecheck script**: still missing —
  same caveat as earlier Steps.
- **`apps/mercato` stale generated import**: `agent-registry.ts(43,7)`
  still references `@/.mercato/generated/ai-agents.generated` which
  is not emitted yet (Step 3.1 carryover). Runtime try/catch hides
  it; TS flags it as a compile-time diagnostic. Drive-by candidate
  for any future Step that touches ai-agents generator output.
- **`search.get_record_context` strategy.** Step 3.8 calls
  `searchService.search(recordId, …)` scoped to a single `entityId`
  and scans the first 5 hits for a `recordId` match. A future Step
  or spec drift MAY add a first-class `getRecordContext({ entityId,
  recordId })` helper to `SearchService`; this tool can then switch
  to the direct call without changing the agent-facing contract.
  Not blocking Phase 1.
- **Attachment transfer duplication**. The existing
  `/api/attachments/transfer` route carries the assignments-patch
  loop inline; Step 3.8's tool mirrors that ~15-line loop through
  `findWithDecryption`. If Step 5.x extracts the logic into a service,
  the tool becomes a thin wrapper. Flagged for the Phase 5 mutation
  gate work.
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

- Dev runtime runnable: unknown. Phase 3 remains runtime + tests
  only.
- Database/migration state: clean, untouched.
- `yarn generate` — re-run in Step 3.8 (new module-root `ai-tools.ts`
  in `packages/ai-assistant`). Step 3.9 (customers) will likely need
  it again if/when we add `ai-tools.ts` to the customers module.

## Worktree

- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's
  primary worktree — documented dogfood exception).
