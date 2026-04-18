# Step 4.7 — First customers AI agent (read-only)

**Date:** 2026-04-18
**Commit (code):** _pending — flipped in docs commit_
**Status:** done

## What landed

- **`packages/core/src/modules/customers/ai-agents.ts`** — the first
  production `ai-agents.ts` file in the repo. Declares the
  `customers.account_assistant` agent (module `customers`) with:
  - `readOnly: true` and `mutationPolicy: 'read-only'` so the Step 3.2
    runtime policy gate rejects any whitelisted tool that returns
    `isMutation: true`.
  - `allowedTools` whitelist of sixteen tools: eleven from the customers
    read-only pack (Step 3.9) plus five general-purpose tools
    (`search.hybrid_search`, `search.get_record_context`,
    `attachments.list_record_attachments`, `attachments.read_attachment`,
    `meta.describe_agent`).
  - `requiredFeatures: ['customers.people.view',
    'customers.companies.view', 'customers.deals.view']` — every id is
    already declared in `packages/core/src/modules/customers/acl.ts`.
  - `acceptedMediaTypes: ['image', 'pdf', 'file']` so the attachment
    bridge (Step 3.7) flows files through.
  - `executionMode: 'chat'` (default), no `defaultModel`, no `maxSteps`
    override, no structured `output` — vanilla defaults.
  - A structured `PromptTemplate` export (`promptTemplate`) with the
    seven spec §8 sections (ROLE, SCOPE, DATA, TOOLS, ATTACHMENTS,
    MUTATION POLICY, RESPONSE STYLE). The file compiles the template to
    the `systemPrompt` string the runtime currently consumes; the
    structured shape is additionally exported so Phase 5.3 prompt
    overrides can address sections by name.
  - `resolvePageContext` stub — async function that returns `null` so
    Step 5.2 can replace the body without widening the public type.
- **Types declared locally.** The customers module does not depend on
  `@open-mercato/ai-assistant` (mirroring the existing comment in
  `ai-tools/types.ts`), so the `AiAgentDefinition` / `PromptTemplate`
  shapes are redeclared as local aliases. Generator imports the file
  through the app bundler — no runtime graph change.
- **`apps/mercato/.mercato/generated/ai-agents.generated.ts`** now
  contains `customers.account_assistant` after `yarn generate`; was
  empty before this Step.
- **Unit tests (new).**
  `packages/core/src/modules/customers/__tests__/ai-agents.test.ts` —
  9 tests covering: read-only flag, execution metadata, tool-whitelist
  membership, no mutation tool slipped in, ACL feature existence, seven
  prompt sections in canonical order, prompt-to-systemPrompt
  compilation, and `resolvePageContext` identity stub.
- **Integration spec (new).**
  `packages/core/src/modules/customers/__integration__/TC-AI-CUSTOMERS-006-account-assistant.spec.ts`
  — three assertions: `GET /api/ai_assistant/ai/agents` returns the
  agent with `readOnly: true` and the expected tool list;
  `meta.describe_agent` via `POST /api/ai_assistant/tools/execute`
  returns the composed prompt with every seven-section header; the
  playground picker at `/backend/config/ai-assistant/playground`
  populates with the new agent option.

## Files touched

### Code commit
- `packages/core/src/modules/customers/ai-agents.ts` (new)
- `packages/core/src/modules/customers/__tests__/ai-agents.test.ts` (new)
- `packages/core/src/modules/customers/__integration__/TC-AI-CUSTOMERS-006-account-assistant.spec.ts` (new)
- `apps/mercato/.mercato/generated/ai-agents.generated.ts` (generator output — includes `customers.account_assistant` import entry)

### Docs-flip commit
- `.ai/runs/2026-04-18-ai-framework-unification/PLAN.md` (row 4.7 → done + short SHA)
- `.ai/runs/2026-04-18-ai-framework-unification/HANDOFF.md` (rewritten, next = Step 4.8)
- `.ai/runs/2026-04-18-ai-framework-unification/NOTIFY.md` (append entry)
- `.ai/runs/2026-04-18-ai-framework-unification/step-4.7-checks.md` (this file)
- `.ai/runs/2026-04-18-ai-framework-unification/step-4.7-artifacts/playground-customers-agent.png`

## Verification

| Check | Outcome |
|-------|---------|
| `cd packages/core && npx jest --config=jest.config.cjs --forceExit --testPathPatterns="customers/.*ai-agents"` | ✅ **1 suite / 9 tests** — new `ai-agents.test.ts`. |
| `cd packages/core && npx jest --config=jest.config.cjs --forceExit --silent` | ✅ **334 suites / 3042 tests** — baseline was 333 / 3033; delta is the new suite (+1 / +9). |
| `cd packages/ai-assistant && npx jest --config=jest.config.cjs --forceExit` | ✅ **30 suites / 353 tests** — baseline preserved. |
| `yarn turbo run typecheck --filter=@open-mercato/core --filter=@open-mercato/ai-assistant --filter=@open-mercato/app` | ✅ clean (1 cache hit, 1 fresh pass). |
| `yarn generate` | ✅ 313 API routes (no drift); `ai-agents.generated.ts` now imports `@open-mercato/core/modules/customers/ai-agents`. |
| `grep customers.account_assistant apps/mercato/.mercato/generated/ai-agents.generated.ts` | ✅ import alias `AI_AGENTS_customers_144` references the file (indirect reference — the generated file does not inline the agent id, it imports the module). |
| `yarn i18n:check-sync` | ✅ 46 modules × 4 locales in sync. No new i18n keys introduced. |

## Browser smoke

- Reused the pre-existing `yarn dev:app` background task on port 3000
  (task id `bk93jo24j`) — did not spawn a second dev server.
- Rebuilt `@open-mercato/core` once (`node build.mjs` in the package)
  so the `dist/modules/customers/ai-agents.js` exists for the Turbopack
  bundler to resolve. Touched `apps/mercato/next.config.ts` afterwards
  to bust Turbopack's cached module graph without restarting the dev
  server itself.
- Logged in as `superadmin@acme.com` / `secret` and captured
  `step-4.7-artifacts/playground-customers-agent.png`. Confirmation
  points on the screenshot:
  - Picker label reads "Customers Account Assistant
    (customers.account_assistant)".
  - Definition card below shows Module `customers`, Execution mode
    `chat`, Mutation policy `read-only`, Allowed tools `16`.
  - Sidebar entries "AI Playground" and "AI Agents" both visible.
  - No more empty-state alert — the registry is populated.

## Integration test

`TC-AI-CUSTOMERS-006` lives under the customers module
(`packages/core/src/modules/customers/__integration__/`) per the
per-module placement rule. It covers the HTTP surface
(`/api/ai_assistant/ai/agents`), the `meta.describe_agent` tool path
(via `/api/ai_assistant/tools/execute`), and the playground picker DOM.

## Decisions

- **(a) ACL features.** The three `requiredFeatures` in the spec brief
  (`customers.people.view`, `customers.companies.view`,
  `customers.deals.view`) all exist in `packages/core/src/modules/customers/acl.ts`.
  No substitution needed. The `customers.list_activities` /
  `customers.list_tasks` / `customers.list_addresses` /
  `customers.list_tags` tools all require `customers.activities.view`
  and the `customers.get_settings` tool requires
  `customers.settings.manage`; callers without those features will
  simply see those tools filtered by the runtime policy gate — the
  agent does not re-demand them at the agent-level required-features
  set. This keeps the minimum bar low enough for standard CRM roles.
- **(b) Excluded customers pack tools.** The customers pack is entirely
  read-only (Step 3.9 landed zero mutations), and the agent whitelists
  every one of its eleven read tools. The test asserts explicitly that
  no `isMutation: true` tool from the pack is in the whitelist — this
  is a regression guard for Step 5.13+ when mutation tools land.
- **(c) Prompt-template divergence from the spec blueprint.** Zero.
  The seven section names match spec §8 line-for-line
  (`role`, `scope`, `data`, `tools`, `attachments`, `mutationPolicy`,
  `responseStyle`). Section contents are customers-specific but follow
  the blueprint order and tone. The spec's optional `overrides`
  section is intentionally not declared — overrides are additive per
  Phase 5.3 and will be appended at runtime once the override system
  lands.
- **Local type declarations.** The file redeclares the agent /
  prompt-template types locally instead of importing them from
  `@open-mercato/ai-assistant`. This mirrors the existing pattern in
  `customers/ai-tools/types.ts` (avoids pulling the assistant into the
  core package's module graph) and respects the fact that
  `@open-mercato/core` does not list `@open-mercato/ai-assistant` in
  its `package.json`. If that dependency direction ever lands (Phase 3
  or later), the local types can be deleted and re-imported from the
  package barrel without a contract change.

## BC impact

Additive only:
- New file `packages/core/src/modules/customers/ai-agents.ts`.
- `apps/mercato/.mercato/generated/ai-agents.generated.ts` now imports
  the new module (was empty before).
- 0 removed exports, 0 renamed files, 0 changed function signatures, 0
  new routes, 0 DB migrations, 0 new ACL features, 0 new i18n keys.

## Follow-ups for Step 4.8

- Replicate the pattern for the first catalog agent. Scaffold
  `packages/core/src/modules/catalog/ai-agents.ts` with the same
  `PromptTemplate` shape and read-only whitelist covering the catalog
  tool packs (Steps 3.10 + 3.11).
- Step 4.9 will then add `catalog.merchandising_assistant` with the
  D18 demo embed on `/backend/catalog/catalog/products`.
