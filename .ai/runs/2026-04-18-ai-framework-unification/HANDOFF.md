# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-18T16:10:00Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
coordinator `in-progress` lock — main session is the dispatcher; the
executor MUST NOT release the lock)
**Current phase/step:** Phase 3 WS-C **complete**. Step 3.13 integration
tests landed; Phase 3 is closed. Next: Phase 4 Step 4.1 — `<AiChat>` UI
component (opens WS-A for the UI layer).
**Last commit:** `f1cc6be3d` —
`test(ai-framework): add WS-C integration tests (runtime policy, attachment bridge, tool-pack coverage)`

## What just happened

- Executor landed **Step 3.13** as one code commit (`f1cc6be3d`) plus a
  docs-flip commit. Step 3.13 closes Phase 3 WS-C and, with it, Phase 3
  overall — the runtime, AI SDK helpers, attachment bridge, tool packs,
  and integration tests all exist and are green.
- Two new Playwright HTTP e2e specs under
  `.ai/qa/tests/ai-framework/`:
  - `TC-AI-001-auth-sanity.spec.ts` — superadmin login reaches `/backend`;
    wrong password stays on `/login` with an error alert. Uses
    `DEFAULT_CREDENTIALS.superadmin` via the shared helper (zero
    password inlining).
  - `TC-AI-002-agent-policy.spec.ts` — HTTP-level dispatcher gate:
    unknown agent → 404 `agent_unknown`; malformed agent query → 400
    `validation_error`; missing agent query → 400 `validation_error`;
    unauthenticated → 401 `unauthenticated`.
- Three new Jest integration suites under
  `packages/ai-assistant/src/modules/ai_assistant/__tests__/integration/`:
  - `ws-c-policy-and-tools.test.ts` — policy gate + tool resolution
    pipeline (unknown / forbidden / super-admin bypass / allowedTools
    filter / tool-level requiredFeatures skip-with-warn /
    `mutation_blocked_by_readonly` / full `runAiAgentText` pass-through
    that asserts the AI SDK tool map contains only whitelisted tools).
    Mirrors the mock stance of
    `agent-runtime-parity.test.ts` (AI SDK mocked at the module boundary)
    so the assertion stays deterministic and provider-agnostic.
  - `ws-c-attachment-bridge.test.ts` — cross-tenant drop (asserts the
    `console.warn` does NOT leak the foreign tenant/org), oversized
    image with no signer → `source: 'metadata-only'`, oversized image
    with a signer → `source: 'signed-url'`, missing DI container
    graceful return (no throw, `[]` + warn).
  - `ws-c-tool-pack-coverage.test.ts` — every search/attachments/meta
    tool declares `requiredFeatures`; tenant-context enforcement on
    `search.hybrid_search` and `attachments.list_record_attachments`;
    `meta.list_agents` empty-registry + RBAC filtering + super-admin
    bypass (with parity check against the same `listAgents()` /
    `hasRequiredFeatures` helpers the chat dispatcher uses);
    end-to-end tool-map composition across the three packs (full map
    resolved with no extras leaked).
- **Explicit scope deferral**: the customer + catalog tool-pack
  scenarios from the Step brief (tenant isolation, not-found shape,
  `includeRelated` aggregates, `search_products` routing,
  `suggest_price_adjustment` `isMutation: false` + `currentPrice: null`
  fallback, `get_product_bundle` found/not-found) remain covered by the
  per-pack unit tests already under
  `packages/core/src/modules/{customers,catalog}/__tests__/ai-tools/**/*.test.ts`.
  Re-testing those from the ai-assistant Jest harness would require
  cross-package plumbing (`moduleNameMapper` doesn't map
  `@open-mercato/core/...`). Documented in the tool-pack integration
  file's header and in `step-3.13-checks.md`. Future work only if the
  cross-package plumbing ever lands.
- **Explicit e2e-to-unit fallback**: the `agent_features_denied` branch
  is exercised in the Jest integration suite rather than through HTTP
  because producing a deterministic forbidden-agent fixture via real
  auth would require touching ACL seed fixtures that are out of scope
  for Step 3.13. Documented in `TC-AI-002` and in the integration test
  file headers.
- **Validation gate** (all green):
  - New integration tests only:
    `cd packages/ai-assistant && npx jest --forceExit --testPathPatterns="__tests__/integration"`
    → 3 suites / **22 tests** / 0.55s.
  - `packages/ai-assistant` full regression: 28 suites / **338 tests**
    (was 25 / 316; delta +3 / +22 matches exactly). No pre-existing
    failures introduced.
  - `packages/core` full regression: 333 suites / **3033 tests**
    preserved exactly. Step 3.13 touched no core production files.
  - Typecheck (`yarn turbo run typecheck --filter=@open-mercato/core
    --filter=@open-mercato/app --force`): 2/2 successful in 23.24s. No
    new diagnostics; only the Step 3.1 `agent-registry.ts(43,7)`
    carryover remains (unchanged).
  - `yarn generate`: not run — Step 3.13 adds only test files, no
    module-root files and no generator inputs.
- **Playwright local run**: `yarn test:integration --list` fails to
  enumerate tests because of a pre-existing env conflict in
  `.ai/tmp/review-pr/pr-1372/` (a stale review worktree with its own
  `@playwright/test` copy). Reproducible before our commit on
  `HEAD~1` — not introduced by Step 3.13. The new Playwright specs
  typecheck cleanly in isolation (`npx tsc --noEmit --isolatedModules`).
  Cleaning the leftover worktree is a separate operator task outside
  this PR's scope. The specs remain runnable under
  `yarn test:integration:ephemeral` or any CI runner with a clean
  workspace.

## Next concrete action

- **Phase 4 Step 4.1** — `<AiChat>` component in
  `packages/ui/src/ai/AiChat.tsx`. This is the Phase 2 WS-A opener:
  - Exported embeddable React component.
  - Speaks the chat dispatcher at
    `/api/ai_assistant/ai/chat?agent=<module>.<agent>` (same path
    TC-AI-002 now covers at the HTTP edge).
  - Accepts `agentId`, `pageContext`, `attachmentIds`, and an optional
    `onResult` callback.
  - Uses `createAiAgentTransport` from Step 3.4 under the hood.
  - DS-compliant (semantic tokens, `lucide-react` icons, `useT`, keyboard
    shortcuts `Cmd/Ctrl+Enter` submit + `Escape` cancel).
  - Unit tests + Playwright where the dev env is runnable; otherwise
    documented in the check file per the skill harness rules.

## Blockers / open questions

- **Cross-package Jest plumbing for ai-assistant integration suite**:
  the `moduleNameMapper` in `packages/ai-assistant/jest.config.cjs`
  only maps `@open-mercato/ai-assistant` and `@open-mercato/shared`.
  Cross-pack integration tests that want to reach
  `@open-mercato/core/modules/{customers,catalog}/ai-tools/*` from
  the ai-assistant side would need a new mapper entry OR a shared
  integration runner. Deferred — the per-pack unit tests already
  exist and are green.
- **Playwright stale-worktree conflict** (`.ai/tmp/review-pr/pr-1372/`)
  — pre-existing; non-blocking. Operator cleanup task.
- **`translations: null` on `catalog.get_product_bundle`** — Phase 4 /
  Phase 5 concern; no contract change.
- **`packages/ai-assistant` typecheck script** — still missing.
- **`apps/mercato` stale generated import** — `agent-registry.ts(43,7)`
  Step 3.1 carryover — runtime try/catch hides it.
- **Step 3.8 handler-variance diagnostics** — repaired by
  `b8817229b`; no longer present.
- **Addresses / tags feature ID drift** (Step 3.9 carryover).
- **`search.get_record_context` strategy** (Step 3.8 carryover).
- **Attachment transfer duplication** (Step 3.8 carryover).
- **`AttachmentSigner` concrete implementation** — still a hook. Step
  3.13 exercises the signed-url promotion via a mocked signer so the
  branch is reachable the moment a concrete signer lands.
- **Object-mode HTTP dispatcher** — deferred to Phase 4 / 5.
- **Tools in object mode** (Step 3.5 gap — AI SDK v6 object entries
  don't accept a `tools` map).
- **User's unstaged spec edit** (~280 lines on
  `.ai/specs/2026-04-11-unified-ai-tooling-and-subagents.md`) still
  out-of-scope.

## Environment caveats

- Dev runtime runnable: unknown (Phase 3 remained runtime + tests
  only). Phase 4 opens the UI layer so Playwright runnability matters
  again from Step 4.1 onward.
- Database/migration state: clean, untouched.
- `.ai/tmp/review-pr/pr-1372/` is a pre-existing stale review worktree
  that breaks local `yarn test:integration --list`. Cleanup is an
  operator task.

## Worktree

- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's
  primary worktree — documented dogfood exception).
