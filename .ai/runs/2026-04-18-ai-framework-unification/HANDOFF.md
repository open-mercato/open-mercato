# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-18T10:05:59Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
coordinator `in-progress` lock — main session is the dispatcher; the
executor MUST NOT release the lock)
**Current phase/step:** Phase 3 WS-A / Step 3.1 landed — agent registry
loader in place. Phase 2 (spec Phase 0) fully landed; Steps 3.2 and 3.3
still pending to close Workstream A.
**Last commit:** `a87bd19f6` —
`feat(ai-assistant): add agent-registry loader for ai-agents.generated.ts`

## What just happened

- Executor subagent landed **Step 3.1** as a single code commit
  (`a87bd19f6`) plus this docs-flip commit.
- New files under
  `packages/ai-assistant/src/modules/ai_assistant/lib/`:
  - `agent-registry.ts` — cached `Map<id, AiAgentDefinition>` populated
    from the generated `allAiAgents` array via a dynamic import of
    `@/.mercato/generated/ai-agents.generated`. Exposes
    `loadAgentRegistry()` (idempotent), `getAgent(id)`,
    `listAgents()` (stable-sorted by id), `listAgentsByModule(moduleId)`,
    and the internal test hooks `resetAgentRegistryForTests()` +
    `seedAgentRegistryForTests(agents)`.
  - `ai-agents-generated.d.ts` — module declaration shim mirroring the
    existing `ai-tools-generated.d.ts`, so TypeScript is happy with the
    dynamic import at build sites that don't have a path-mapper yet.
  - `__tests__/agent-registry.test.ts` — 8 new tests (empty-registry
    on missing file, fixture population, stable-sort, module filter,
    duplicate-id throws, malformed-entry warn-skip, reset hook,
    idempotent re-load).
- `packages/ai-assistant/src/index.ts` re-exports the public read-API
  (`loadAgentRegistry`, `getAgent`, `listAgents`, `listAgentsByModule`,
  `resetAgentRegistryForTests`). `seedAgentRegistryForTests` stays
  intentionally unexported — internal testing hook only.
- Registry stores `AiAgentDefinition` objects verbatim (no projection),
  which avoids the additive-field loss flagged in the Step 2.5 HANDOFF
  carryover about the MCP tool registry path. Step 3.2 will lean on
  this: policy checks on `requiredFeatures` / `allowedTools` /
  `readOnly` / `mutationPolicy` / `executionMode` need the full
  `AiAgentDefinition`, not a subset.
- Unit tests: 14/14 suites, 187/187 tests in `packages/ai-assistant`
  (baseline 13/179; delta +1 suite, +8 tests). Typecheck on
  `@open-mercato/core` green (cache hit); `@open-mercato/app`
  typecheck still fails on the documented pre-existing
  `example/customer-tasks/page` entry in `backend-routes.generated.ts`.
  Grep of typecheck output for `agent-registry` /
  `ai-agents-generated` matched zero lines — no new diagnostics.

## Next concrete action

- **Step 3.2** — Spec Phase 1 WS-A — Runtime policy checks:
  `requiredFeatures`, `allowedTools`, `readOnly`, attachment access,
  `executionMode`.
  - Expected new module (or inline in the dispatcher scaffold): a
    policy helper under
    `packages/ai-assistant/src/modules/ai_assistant/lib/`. Candidate
    path: `agent-runtime.ts` (covering the shared policy + invocation
    context) or a more focused `agent-policy.ts` if the runtime is
    split across Steps 3.2 + 3.3.
  - Consumer: Step 3.2 is the **first** Step that calls into
    `getAgent(id)` from `agent-registry.ts`. Expect imports of
    `getAgent` from `@open-mercato/ai-assistant`.
  - Policy surface (per spec §4): `requiredFeatures` against user ACL
    (mirror `hasRequiredFeatures` used by the MCP HTTP server),
    `allowedTools` narrowing the tool registry returned to the agent,
    `readOnly` / `mutationPolicy` gating `isMutation: true` tools,
    `acceptedMediaTypes` vs incoming attachment parts, and
    `executionMode` routing chat vs object.
  - Unit tests: happy path + each rejection branch. No UI.
- Phase 3 Workstream A runs Steps 3.1 → 3.3 back-to-back (registry →
  policy gate → HTTP dispatcher). Keep each Step to one commit.

## Blockers / open questions

- **`packages/ai-assistant` typecheck script**: still missing. The
  package has no `tsc --noEmit` npm script, so we lean on focused
  standalone typecheck projects for Step-level checks. Candidate for a
  Phase 5 cleanup Step.
- **`apps/mercato` stale generated route**: pre-existing
  `example/backend/customer-tasks/page` entry in
  `backend-routes.generated.ts` blocks `@open-mercato/app:typecheck`.
  Unrelated to AI work; consider a drive-by `yarn generate` Step if it
  persists into Phase 3.
- **User's unstaged spec edit** (~280 lines on
  `.ai/specs/2026-04-11-unified-ai-tooling-and-subagents.md`) remains
  out-of-scope. Step 3.1 read the committed HEAD view of the spec
  only.
- **Tool-registry additive-field loss** (from Step 2.5 HANDOFF): still
  open. Step 3.1 sidesteps it for agents by storing full
  `AiAgentDefinition` verbatim, but the tool-side projection through
  `McpToolDefinition` still drops `displayName` / `tags` /
  `isMutation` / `maxCallsPerTurn` / `supportsAttachments`. Step 3.2
  (policy gate) needs at least `isMutation` — decide there whether to
  widen `McpToolDefinition` or read `isMutation` off a parallel
  side-channel.

## Environment caveats

- Dev runtime runnable: unknown. Phase 3 through Step 3.10 is
  runtime + tests-only (no UI), so Playwright stays N/A. Phase 3
  integration tests (Step 3.6, 3.13) may exercise `apiCallOrThrow`
  against in-process mocks if the dev env is unrunnable.
- Database/migration state: clean, untouched. First migration lands
  in Phase 5 (Step 5.5, `AiPendingAction` table).
- `yarn generate` will regenerate
  `apps/mercato/.mercato/generated/ai-tools.generated.ts` and
  `ai-agents.generated.ts` on next run; Step 2.2 wired the generator,
  Step 2.3 the tool loader, Step 2.5 the regression coverage, Step 3.1
  the agent registry loader.

## Worktree

- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's
  primary worktree). Documented dogfood exception (see earlier NOTIFY
  entries). Any follow-up PR spun out of Phase 2+ MUST use an isolated
  worktree per the skill default.
