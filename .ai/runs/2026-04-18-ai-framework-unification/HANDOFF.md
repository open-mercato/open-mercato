# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-18T10:37:31Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
coordinator `in-progress` lock — main session is the dispatcher; the
executor MUST NOT release the lock)
**Current phase/step:** Phase 3 WS-A / Step 3.2 landed — agent runtime
policy gate in place. Step 3.3 is the last WS-A Step before WS-B
(AI SDK helpers) opens.
**Last commit:** `4f3b8b737` —
`feat(ai-assistant): add runtime policy gate for agent + tool + attachment checks`

## What just happened

- Executor landed **Step 3.2** as a single code commit (`4f3b8b737`)
  plus this docs-flip commit.
- New file
  `packages/ai-assistant/src/modules/ai_assistant/lib/agent-policy.ts`:
  - `checkAgentPolicy(input): AgentPolicyDecision` — pure policy helper
    consuming the agent registry + tool registry + auth context and
    returning a typed allow/deny decision.
  - 9 deny codes covering every Phase 1 runtime gate: `agent_unknown`,
    `agent_features_denied`, `tool_not_whitelisted`, `tool_unknown`,
    `tool_features_denied`, `mutation_blocked_by_readonly`,
    `mutation_blocked_by_policy`, `execution_mode_not_supported`,
    `attachment_type_not_accepted`.
  - Reuses `hasRequiredFeatures` from `auth.ts` for both agent-level
    and tool-level feature checks, so super-admin bypass + wildcard
    feature patterns stay consistent with the MCP HTTP server.
- `readOnly` defaults to `true` when the field is not declared (v1
  spec rule §4). The default-read-only test case proves that implicit
  agents still reject mutation tools.
- Execution-mode gate is symmetric: `object` requested on a chat-mode
  agent without `output` → denied; `chat` requested on an explicit
  object-mode agent with `output` → denied. Agents declared as
  `executionMode: 'chat'` but carrying an `output` schema can still run
  in object mode (that's the structured-output opt-in path Step 3.5
  relies on).
- Attachment gate: agents without `acceptedMediaTypes` reject ALL
  attachments (opt-in); agents with a declared set reject any requested
  media type that doesn't classify into that set. Classification is
  MIME-prefix based: `image/*` → `image`, `application/pdf` → `pdf`,
  everything else → `file`.
- `packages/ai-assistant/src/index.ts` re-exports `checkAgentPolicy`
  and the four types (`AgentPolicyDenyCode`, `AgentPolicyDecision`,
  `AgentPolicyAuthContext`, `AgentPolicyCheckInput`) under a new
  "Agent runtime policy gate" export block. Additive only.
- Unit tests: 15 suites / 204 tests in `packages/ai-assistant`
  (baseline 14/187; delta +1 suite, +17 tests). New test file
  `agent-policy.test.ts` covers every deny code + success paths +
  super-admin bypass + default-read-only behavior. Typecheck grep
  over `@open-mercato/core` + `@open-mercato/app` for `agent-policy`
  returns zero matches — no new diagnostics.

## Next concrete action

- **Step 3.3** — Spec Phase 1 WS-A —
  `POST /api/ai/chat?agent=<module>.<agent>` route with `metadata` +
  `openApi`.
  - Expected new file: `packages/ai-assistant/src/modules/ai_assistant/api/ai/chat/route.ts`
    (Next.js-style auto-discovered API route — file name MUST be
    `route.ts`, exported method handlers dispatch by HTTP method).
  - MUST export `metadata` with `requireAuth: true` (or explicit
    feature guard) and `openApi` for the route — per root AGENTS.md
    surface 7.
  - Consumer of Step 3.2: on request, resolve the `agent` query param,
    call `checkAgentPolicy({ agentId, authContext, requestedExecutionMode })`,
    return the structured deny reason on any `ok: false` branch
    (`agent_unknown` → 404; `agent_features_denied` → 403; everything
    else → 400 or 403 as appropriate).
  - This Step does NOT wire the AI SDK transport yet — that's Step 3.4.
    The route body can return a placeholder `{ ok: true, agentId }`
    response so the plumbing can be exercised by integration tests
    without the full model runtime.
  - Phase 3 WS-A closes after Step 3.3.

## Blockers / open questions

- **`packages/ai-assistant` typecheck script**: still missing. The
  package has no `tsc --noEmit` npm script, so we lean on focused
  standalone typecheck projects for Step-level checks. Candidate for
  a Phase 5 cleanup Step.
- **`apps/mercato` stale generated route**: pre-existing
  `example/backend/customer-tasks/page` entry in
  `backend-routes.generated.ts` still blocks
  `@open-mercato/app:typecheck`. Unrelated to AI work; drive-by
  `yarn generate` candidate if it persists into Phase 3.
- **User's unstaged spec edit** (~280 lines on
  `.ai/specs/2026-04-11-unified-ai-tooling-and-subagents.md`) still
  out-of-scope. Step 3.2 read the committed HEAD view of the spec
  only.
- **Tool-registry additive-field loss** (from Step 2.5 HANDOFF): Step
  3.2 sidesteps this by casting `toolRegistry.getTool()` to
  `AiToolDefinition` and reading `isMutation` off the same object
  reference. Tools registered with `isMutation: true` via plain-object
  literals (including `defineAiTool()` output) retain the field on
  the same object, so the cast is BC-safe for current call sites.
  Tools that end up without `isMutation` are treated as non-mutation
  by default — the mutation gates only fire on explicit `true`. When
  Step 2.5's widening lands, `agent-policy.ts` picks it up without
  change.

## Environment caveats

- Dev runtime runnable: unknown. Phase 3 through Step 3.10 is runtime
  + tests-only (no UI), so Playwright stays N/A. Step 3.3 is the first
  Step since Phase 2 that touches the auto-discovery surface (API
  route) — expect `yarn generate` to regenerate
  `apps/mercato/.mercato/generated/backend-routes.generated.ts` and
  `api-routes.generated.ts`.
- Database/migration state: clean, untouched. First migration lands
  in Phase 5 (Step 5.5, `AiPendingAction` table).
- Step 3.2 required no generated-file regeneration (library helper
  only, no auto-discovery surface).

## Worktree

- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's
  primary worktree). Documented dogfood exception (see earlier NOTIFY
  entries). Any follow-up PR spun out of Phase 2+ MUST use an isolated
  worktree per the skill default.
