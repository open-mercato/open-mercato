# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-18T19:05:00Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
coordinator `in-progress` lock — main session is the dispatcher; the
executor MUST NOT release the lock)
**Current phase/step:** Phase 4 WS-C Step 4.7 **complete** (opens Phase 2
WS-C: first customers production agent with structured prompt template,
read-only). Next: Step 4.8 — first catalog agent with prompt template,
read-only.
**Last commit:** `c4cba55ad` — `feat(customers): add customers.account_assistant read-only AI agent (Phase 2 WS-C)`

## What just happened

- **First production `ai-agents.ts` landed** under
  `packages/core/src/modules/customers/ai-agents.ts`. Declares a single
  agent `customers.account_assistant` (module `customers`). Picks up the
  Step 2.1 `defineAiAgent` contract (but uses plain-object assignment
  since the customers module is not declared as a dependent of
  `@open-mercato/ai-assistant`). 16-tool whitelist, `readOnly: true`,
  `mutationPolicy: 'read-only'`, `executionMode: 'chat'`,
  `acceptedMediaTypes: ['image', 'pdf', 'file']`, `requiredFeatures`
  covering people / companies / deals view.
- **Structured prompt template** (`promptTemplate`) exports the seven
  §8 sections (ROLE, SCOPE, DATA, TOOLS, ATTACHMENTS, MUTATION POLICY,
  RESPONSE STYLE) and is additionally compiled into the string
  `systemPrompt` the runtime consumes. Phase 5.3 prompt overrides can
  address sections by name without renaming anything.
- **`resolvePageContext` stub** — async function that returns `null`.
  Step 5.2 will replace the body with real record hydration.
- **Types redeclared locally** to avoid pulling `@open-mercato/ai-assistant`
  into the `@open-mercato/core` module graph (mirrors the existing
  pattern in `customers/ai-tools/types.ts`). `@open-mercato/core` does
  not list `@open-mercato/ai-assistant` in its `package.json`, so the
  indirect import surfaced as a hard typecheck failure until the
  aliases moved in-file.
- **Generated agent registry populated.** `yarn generate` emits
  `apps/mercato/.mercato/generated/ai-agents.generated.ts` with the
  `AI_AGENTS_customers_144` import alias referencing the new file.
  Playground and settings pages both leave the empty-state branch and
  surface the agent in their picker.
- **Unit tests (9)**
  `packages/core/src/modules/customers/__tests__/ai-agents.test.ts`
  assert: the `readOnly` flag, execution metadata (no defaultModel /
  maxSteps / output), tool-whitelist membership (customers pack +
  general-purpose), no mutation tool slipped in from the pack, every
  `requiredFeatures` id exists in `acl.ts`, the seven §8 sections are
  present in canonical order, the systemPrompt compiles from the
  template, and `resolvePageContext` is an async identity stub.
- **Integration spec** `TC-AI-CUSTOMERS-006` under the customers module
  (`packages/core/src/modules/customers/__integration__/`) covers the
  three entry points: `GET /api/ai_assistant/ai/agents`,
  `meta.describe_agent` via `POST /api/ai_assistant/tools/execute`, and
  the playground picker DOM.
- **Browser smoke** captured as
  `step-4.7-artifacts/playground-customers-agent.png`. Reused the
  pre-existing `yarn dev:app` background task on port 3000; rebuilt
  `@open-mercato/core` and touched `apps/mercato/next.config.ts` to
  bust the Turbopack module graph cache.

## Next concrete action

- **Step 4.8** — First catalog agent with prompt template (read-only).
  Scaffold `packages/core/src/modules/catalog/ai-agents.ts` with the
  same `PromptTemplate` shape and a read-only whitelist covering the
  catalog tool packs (Steps 3.10 + 3.11). Reuse the local-type pattern
  introduced here since `@open-mercato/core` is still off the
  `@open-mercato/ai-assistant` dependency graph.
- Step 4.9 will then add `catalog.merchandising_assistant` with the
  D18 demo embed on `/backend/catalog/catalog/products`, selection-aware
  `pageContext`, and structured-output proposals only.

## Blockers / open questions

- **Core → ai-assistant dependency direction.** `@open-mercato/core`
  does NOT declare `@open-mercato/ai-assistant` in `package.json`, so
  `import type { AiAgentDefinition } from '@open-mercato/ai-assistant'`
  fails typecheck. Worked around by redeclaring the shapes locally,
  matching the existing pattern in `customers/ai-tools/types.ts`.
  Step 4.8 should take the same path. If that dependency direction is
  ever intentionally added, the local aliases can be replaced with a
  single `import type` line without any contract change.
- **Turbopack cache invalidation.** Adding a new module-root file that
  the generator discovers and imports through
  `.mercato/generated/ai-agents.generated.ts` required
  `cd packages/core && node build.mjs` + touching
  `apps/mercato/next.config.ts` before the dev server could resolve
  `@open-mercato/core/modules/customers/ai-agents`. Document in Step
  4.8 so the next executor doesn't waste time on the same trap.
- **Integration test not executed.** `yarn test:integration` was NOT
  run for this Step because the full suite is not part of the
  unit-gate baselines the brief tracks. `TC-AI-CUSTOMERS-006` is
  deterministic superadmin + API + DOM; it will be exercised as part
  of Step 4.11 cross-cutting coverage.

## Environment caveats

- Dev runtime reachable. Reused the pre-existing `yarn dev:app`
  background task on port 3000 (task id `bk93jo24j`). No second dev
  server spawned.
- Database / migration state: clean, untouched.
- `yarn i18n:check-sync` green (46 modules × 4 locales). No new i18n
  keys introduced in Step 4.7.
- Typecheck clean (`@open-mercato/core` rebuild cache-busted; app
  cached).

## Worktree

- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's
  primary worktree — documented dogfood exception).
