# Step 5.3 — Phase 3 WS-B verification notes

**Commit (code):** `656158c98`
**Branch:** `feat/ai-framework-unification`
**Date:** 2026-04-19 UTC

## Summary

Replaced the Step-4.5 placeholder `POST /api/ai_assistant/ai/agents/:agentId/prompt-override`
route with tenant-scoped versioned persistence, added a GET endpoint that
returns `{ override, versions }`, wired the chat dispatcher +
`runAiAgentObject` to layer the latest override onto the built-in
`systemPrompt`, and surfaced the override + history in the settings UI.

## Unit tests

All three new suites plus every pre-existing suite remain green.

| Suite | Tests | Notes |
|-------|-------|-------|
| `lib/__tests__/prompt-override-merge.test.ts` | 11 | identity / append / insert after RESPONSE STYLE / reserved-key throw / case-insensitive key match |
| `data/repositories/__tests__/AiAgentPromptOverrideRepository.test.ts` | 7 | monotonic version, tenant scoping, capped history, whitespace-only values dropped, tenantId required |
| `api/ai/agents/[agentId]/prompt-override/__tests__/route.test.ts` | 12 | POST + GET happy / auth / forbidden / validation / reserved-key / legacy `overrides` alias |

### Counts

- `@open-mercato/ai-assistant`: **33 / 386** (baseline 31 / 363 → +2 / +23).
- `@open-mercato/core`: **338 / 3094** (baseline preserved).
- `@open-mercato/ui`: **60 / 328** (baseline preserved).

## Typecheck

`yarn turbo run typecheck --filter=@open-mercato/ai-assistant --filter=@open-mercato/core --filter=@open-mercato/app --force`
→ **all 2 packages (`@open-mercato/core`, `@open-mercato/app`) green**. The
ai-assistant package has no typecheck script — its Jest suite + ts-jest
acts as the TS gate.

## Generators

- `yarn generate` — green, zero drift. The new entity surfaces through
  `apps/mercato/.mercato/generated/entities.generated.mjs` (grep
  `ai_assistant_27` for the new import + `enhanceEntities` call).
- `cd packages/ai-assistant && node build.mjs` — clean rebuild so the
  generator can resolve the compiled `@open-mercato/ai-assistant/.../data/entities`
  import from `node_modules`.
- `touch apps/mercato/next.config.ts` — applied (Turbopack cache recipe).

## Migration

`yarn db:generate` — emits
`packages/ai-assistant/src/modules/ai_assistant/migrations/Migration20260419100521.ts`.
Shape (excerpt, filtered to the new table so pre-existing monorepo
schema drift from other modules doesn't land here):

```sql
create table "ai_agent_prompt_overrides" (
  "id" uuid not null default gen_random_uuid(),
  "tenant_id" uuid not null,
  "organization_id" uuid null,
  "agent_id" text not null,
  "version" int not null,
  "sections" jsonb not null,
  "notes" text null,
  "created_by_user_id" uuid null,
  "created_at" timestamptz not null,
  "updated_at" timestamptz not null,
  constraint "ai_agent_prompt_overrides_pkey" primary key ("id")
);
create index "ai_agent_prompt_overrides_tenant_org_agent_version_idx"
  on "ai_agent_prompt_overrides" ("tenant_id", "organization_id", "agent_id", "version" desc);
create index "ai_agent_prompt_overrides_tenant_agent_idx"
  on "ai_agent_prompt_overrides" ("tenant_id", "agent_id");
alter table "ai_agent_prompt_overrides"
  add constraint "ai_agent_prompt_overrides_tenant_org_agent_version_uq"
  unique ("tenant_id", "organization_id", "agent_id", "version");
```

The migration `down()` issues `drop table if exists ... cascade`, so the
change is reversible.

Snapshot: `packages/ai-assistant/src/modules/ai_assistant/migrations/.snapshot-open-mercato.json`
— checked in alongside the migration so future `yarn db:generate` runs
diff against a correct baseline and produce no drift.

## i18n

`yarn i18n:check-sync` → **all translation files in sync** across
en / pl / es / de. New keys land under `ai_assistant.agents.override.*`
(13 keys) with full translations for en / pl / es / de (no placeholder
rows — all four locales carry real strings).

## Key decisions

- **Monotonic version allocation** is handled via `em.transactional()`
  (the `withAtomicFlush` helper referenced in AGENTS.md is spec-only
  today). Inside the transaction we read `findOneWithDecryption` with
  `orderBy: { version: 'desc' }` and insert `latest.version + 1`. Two
  concurrent writers can race the read, but the unique constraint
  `(tenantId, organizationId, agentId, version)` converts the collision
  into a 409-equivalent DB error instead of silent double-v1.
- **Merge rule confirmation:** canonical-section overrides **APPEND** to
  the built-in section body with a blank-line separator (never replace).
  Brand-new header keys become a new section appended right after
  `responseStyle` (before `overrides`, if any). This matches the
  spec (§8) "additive only" constraint.
- **Dispatcher wiring:** layered in `agent-runtime.ts`
  (`composeSystemPrompt` → `resolveBaseSystemPromptWithOverride`) so
  both `runAiAgentText` and `runAiAgentObject` get identical behavior
  via one helper. The chat `POST /api/ai/chat?agent=...` route needed
  no changes — it already calls `runAiAgentText(...)` with the DI
  container. Fail-open: any repo error or missing `em` falls back to
  the built-in prompt and logs at `warn`.
- **i18n-keyed error messages:** `ai_assistant.agents.override.errors.reservedKey`
  surfaces the reserved-policy-key error to the Settings UI; success
  path uses `ai_assistant.agents.override.savedTitle` +
  `ai_assistant.agents.override.savedMessage`.

## BC

- POST response migrated from `{ pending: true, ... }` (Step 4.5) to
  `{ ok: true, version, updatedAt }`. Status code stays 200 so
  pre-Step-5.3 callers that only check HTTP status keep working. The
  settings client sends both `sections` and `overrides` keys so
  pre-Step-5.3 servers keep working too.
- No import paths removed; no event IDs renamed; no database columns
  dropped. The contract surfaces touched are all strictly additive (new
  entity + new route verb + new i18n keys).

## Integration spec

`TC-AI-AGENT-SETTINGS-005-settings-page.spec.ts` gains two scenarios:

1. Happy path: saves an override, asserts the success alert + the
   `data-ai-agent-override-history-row="1"` marker appears.
2. Reserved-key path: POST returns 400 / `reserved_key`, the UI surfaces
   an i18n-keyed destructive alert mentioning the policy fields.

Both scenarios stub the dispatcher / registry exactly like the existing
specs in this file — Playwright did not run against a live model.
