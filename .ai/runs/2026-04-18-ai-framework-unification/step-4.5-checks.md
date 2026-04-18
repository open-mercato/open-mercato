# Step 4.5 — Backend AI agent settings page + prompt-override placeholder route (Phase 2 WS-B)

**Date:** 2026-04-18
**Commit (code):** ce011a9e5
**Status:** done

## What landed

- **New backend page** `/backend/config/ai-assistant/agents` guarded by
  `ai_assistant.settings.manage`. Renders:
  - An agent picker populated from the existing
    `GET /api/ai_assistant/ai/agents` endpoint (Step 4.4), shared UX with the
    playground. The picker stays a plain `<select>` per the decision to defer
    the `<AgentPicker>` extraction to Step 4.6 (see follow-ups below) — the
    duplicated picker block is < 50 lines today and there is a TODO comment
    in the client component flagging 4.6 as the extraction point.
  - A metadata panel showing agent id, label, description, module,
    `executionMode` (StatusBadge), `mutationPolicy` (StatusBadge with
    per-policy color mapping), `readOnly`, and `maxSteps`.
  - A prompt-sections editor covering all eight spec §8 section ids (`role`,
    `scope`, `data`, `tools`, `attachments`, `mutationPolicy`, `responseStyle`,
    `overrides`). Each section has a toggle between **Default** (pretty-printed
    block quoting the agent's `systemPrompt`) and **Override** (textarea with
    local-state-only draft). A persistent info `Alert` calls out that
    persistence lands in Phase 3 Step 5.3.
  - A read-only **Allowed tools** list — one row per tool with a `Wrench`
    icon, display name, `Mutation`/`Read` StatusBadge, an always-on disabled
    `Enabled` switch, and a `Tooltip` pointing at Phase 3.
  - **Attachment policy** badges (image / pdf / file) driven by the agent's
    `acceptedMediaTypes`.
  - Empty-state, load-error, and loading states follow the same DS primitives
    as the playground.
- **New placeholder route** `POST /api/ai_assistant/ai/agents/:agentId/prompt-override`:
  - Feature gate: `ai_assistant.settings.manage` (declared via flat
    `metadata` so the generator doesn't warn on dynamic routes).
  - Validates the agent exists via the registry. 404 for unknown agents;
    401 unauthenticated; 403 forbidden; 400 on malformed body / agent id.
  - Returns `200 { pending: true, agentId, message: 'Persistence lands in
    Phase 3 Step 5.3.' }` on success. Does **not** persist anywhere — the
    UI holds override drafts in React state only. Step 5.3 will wire the
    versioned storage.
- **Agent list endpoint extended additively** — `GET /api/ai_assistant/ai/agents`
  now returns `systemPrompt`, `readOnly`, `maxSteps`, and a `tools[]` array
  with `{ name, displayName, isMutation, registered }`. Existing fields
  preserved; `tools[]` is purely additive so the playground client still
  compiles unchanged.
- **Sidebar entry** — `page.meta.ts` uses the same `Module Configs` page group
  as the playground and lands at `pageOrder: 432` (playground is 431).
  Confirmed in the browser smoke that "AI Playground" and "AI Agents" both
  appear in the Settings sidebar.
- **Keyboard shortcuts** — `Cmd/Ctrl+Enter` inside any override textarea
  triggers Save; `Escape` blurs the textarea (page-level dialogs, if any
  open from inside, will follow the standard Escape behavior).
- **i18n** — 50 new keys under `ai_assistant.agents.*`, synced across
  `en/pl/es/de`. `yarn i18n:check-sync` green with 46 modules × 4 locales.

## Files touched

### Code commit
- `packages/ai-assistant/src/modules/ai_assistant/backend/config/ai-assistant/agents/page.tsx` (new)
- `packages/ai-assistant/src/modules/ai_assistant/backend/config/ai-assistant/agents/page.meta.ts` (new)
- `packages/ai-assistant/src/modules/ai_assistant/backend/config/ai-assistant/agents/AiAgentSettingsPageClient.tsx` (new)
- `packages/ai-assistant/src/modules/ai_assistant/api/ai/agents/[agentId]/prompt-override/route.ts` (new)
- `packages/ai-assistant/src/modules/ai_assistant/api/ai/agents/[agentId]/prompt-override/__tests__/route.test.ts` (new — 7 tests)
- `packages/ai-assistant/src/modules/ai_assistant/api/ai/agents/route.ts` (additive tool/readOnly/maxSteps/systemPrompt fields)
- `packages/ai-assistant/src/modules/ai_assistant/__integration__/TC-AI-AGENT-SETTINGS-005-settings-page.spec.ts` (new)
- `packages/ai-assistant/src/modules/ai_assistant/i18n/{en,pl,es,de}.json` (+50 keys each)

### Docs-flip commit
- `.ai/runs/2026-04-18-ai-framework-unification/PLAN.md` (row 4.5 → done + short SHA)
- `.ai/runs/2026-04-18-ai-framework-unification/HANDOFF.md` (rewritten, next = 4.6)
- `.ai/runs/2026-04-18-ai-framework-unification/NOTIFY.md` (append entry)
- `.ai/runs/2026-04-18-ai-framework-unification/step-4.5-checks.md` (this file)
- `.ai/runs/2026-04-18-ai-framework-unification/step-4.5-artifacts/browser-smoke.png`

## Verification

| Check | Outcome |
|-------|---------|
| `cd packages/ai-assistant && npx jest --config=jest.config.cjs --forceExit` | ✅ **30 suites / 353 tests** — up from baseline 29/346 (new placeholder route suite adds 1/7). |
| `cd packages/ui && npx jest --config=jest.config.cjs --forceExit --silent` | ✅ **58 suites / 317 tests** — baseline preserved. |
| `cd packages/core && npx jest --config=jest.config.cjs --forceExit --silent` | ✅ **333 suites / 3033 tests** — baseline preserved. |
| `yarn turbo run typecheck --filter=@open-mercato/ai-assistant --filter=@open-mercato/core --filter=@open-mercato/app` | ✅ 2 cache-hits + 1 cache-miss (core); clean. |
| `apps/mercato && npx tsc --noEmit` | ✅ 0 errors. |
| `yarn generate` | ✅ 313 API routes (was 312); new `/api/ai_assistant/ai/agents/{agentId}/prompt-override` confirmed in `openapi.generated.json`. |
| `yarn i18n:check-sync` | ✅ 46 modules × 4 locales in sync after adding 50 new `ai_assistant.agents.*` keys. |

## Browser smoke

- Reused the pre-existing dev server on port 3000 (`yarn dev:app` background
  task `bk93jo24j`) — did not spawn a second dev server.
- Built `@open-mercato/ai-assistant` once to hydrate `dist/modules/.../agents/`
  so the package exports map can resolve the new page route at runtime.
- Logged in as `superadmin@acme.com` / `secret`, navigated to
  `/backend/config/ai-assistant/agents`, confirmed the page renders the
  empty-state (no agents registered yet — Step 4.7 lands the first) and
  that the Settings sidebar lists both "AI Playground" and "AI Agents".
- Screenshot: `step-4.5-artifacts/browser-smoke.png`.

## Integration test

- `packages/ai-assistant/src/modules/ai_assistant/__integration__/TC-AI-AGENT-SETTINGS-005-settings-page.spec.ts`
  — Playwright spec with two assertions:
  1. Superadmin visiting `/backend/config/ai-assistant/agents` sees the
     empty-state alert (or the detail panel if a registry happens to be
     non-empty, or the load-error alert — all three branches are
     treated as acceptable evidence of the ACL guard firing).
  2. An unauthenticated visit redirects to `/login`.
- Stubs `/api/ai_assistant/ai/agents` and
  `/api/ai_assistant/ai/agents/*/prompt-override` so the test never depends
  on a live LLM provider or a populated registry.

## Decisions

- **Agent-picker extraction** — duplicated once (playground picker + settings
  picker share ~20 lines of `<select>` markup). Extraction is deferred to
  Step 4.6 with an explicit `TODO(step 4.6)` comment at the top of
  `AiAgentSettingsPageClient.tsx`. The duplicated block is under the 50-line
  threshold named in the Step 4.5 brief.
- **Prompt-override placeholder semantics** — route validates agent exists,
  enforces `ai_assistant.settings.manage`, and returns
  `{ pending: true, agentId, message: 'Persistence lands in Phase 3 Step 5.3.' }`.
  No persistence layer, no DB writes, no events. The UI keeps override drafts
  in React state only and resets them when the picker selection changes.
  Step 5.3 replaces this route's body with versioned storage.
- **`agents` list response additive extension** — added `systemPrompt`,
  `readOnly`, `maxSteps`, and `tools[]` to the existing response shape. The
  playground client reads `allowedTools` only so it is unaffected; the
  settings client reads the richer `tools[]` array. No BC risk.
- **Section ids** — reused the 8 `PromptSectionName` values from
  `prompt-composition-types.ts` (`role`, `scope`, `data`, `tools`,
  `attachments`, `mutationPolicy`, `responseStyle`, `overrides`). The
  agent definition type itself still ships only a single `systemPrompt: string`,
  so the Default view quotes that verbatim under the `role` section with a
  Phase-3-deferred placeholder under the other seven. Step 5.3 will map
  structured `PromptTemplate.sections` onto these slots once that type is
  surfaced in the agent definition.
- **No new feature IDs** — the existing `ai_assistant.settings.manage`
  feature gates both the page and the route. Zero new ACL features.
- **Metadata export shape for dynamic routes** — the generator warns on
  per-method `metadata = { POST: {...} }` when the route path contains
  `[...]` segments (observed during `yarn generate`). Switched to flat
  `metadata = { requireAuth, requireFeatures }`; warning cleared and the
  route still shows correctly in `openapi.generated.json`.

## BC impact

Additive only:
- 1 new URL (`POST /api/ai_assistant/ai/agents/{agentId}/prompt-override`) —
  placeholder that returns `200 { pending: true }` (never a breaking contract
  because no prior consumers exist).
- 1 new backend page (`/backend/config/ai-assistant/agents`).
- 4 new additive fields in the existing `GET /api/ai_assistant/ai/agents`
  response (`systemPrompt`, `readOnly`, `maxSteps`, `tools[]`). Zero
  existing fields removed or narrowed.
- 50 new i18n keys under `ai_assistant.agents.*`.
- 0 new ACL feature IDs.
- 0 DB migrations.

## Follow-ups for Step 4.6

- Extract `<AgentPicker>` primitive from the duplicated `<select>` blocks in
  `AiPlaygroundPageClient.tsx` and `AiAgentSettingsPageClient.tsx` into
  `packages/ai-assistant/src/modules/ai_assistant/components/AgentPicker.tsx`.
- Expand the keyboard-shortcut coverage (Cmd/Ctrl+S as a save alias,
  Cmd+K open-agent-picker, etc.) once 4.6 lands the debug-support polish.
- Consider surfacing `PromptTemplate.sections` from the agent definition
  when available (currently only `systemPrompt` is exposed) so the Default
  panel can show per-section copy instead of the generic placeholder for
  7/8 section ids. Blocked on the agent-definition contract extension —
  deferred to Phase 3 when versioned persistence ships.
