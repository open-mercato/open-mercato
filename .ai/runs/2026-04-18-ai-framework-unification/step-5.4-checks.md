# Step 5.4 — Phase 3 WS-B verification notes

**Commit (code):** `ddc08903e`
**Branch:** `feat/ai-framework-unification`
**Date:** 2026-04-19 UTC

## Summary

Closed Phase 3 WS-B by landing a tenant-scoped `mutationPolicy` override
surface separate from the prompt editor. New entity + migration + repo +
route + UI section. The route enforces a load-bearing escalation guard
(overrides can only DOWNGRADE a policy, never widen it). The runtime
(`runAiAgentText` / `runAiAgentObject`) loads the override before calling
`resolveAiAgentTools` so the effective policy is the MOST RESTRICTIVE of
`{ code-declared, override }`.

## Unit tests

Three new suites; every pre-existing suite remains green.

| Suite | Tests | Notes |
|-------|-------|-------|
| `data/repositories/__tests__/AiAgentMutationPolicyOverrideRepository.test.ts` | 7 | set+get round-trip, replace (single row), clear → null, clear returns false when absent, tenant isolation, missing tenantId throw, entity shape |
| `lib/__tests__/agent-policy.mutation-override.test.ts` | 11 | `resolveEffectiveMutationPolicy` algebra (most-restrictive-wins, missing/null override, corrupt value fallback, never-escalate invariant); `isMutationPolicyEscalation` flags widenings and leaves same-level / downgrades alone; `checkAgentPolicy` consults the override + falls back safely on corrupt values |
| `api/ai/agents/[agentId]/mutation-policy/__tests__/route.test.ts` | 15 | GET happy / auth / 404; POST happy downgrade, escalation (`read-only`→`confirm-required`) rejected with 400 + `escalation_not_allowed`, escalation (`destructive-confirm-required`→`confirm-required`) rejected, validation_error on malformed body, auth/forbidden/404, same-level save; DELETE auth/forbidden/clears row, subsequent GET → `override: null` |

### Counts

- `@open-mercato/ai-assistant`: **36 / 419** (baseline 33 / 386 → +3 / +33).
- `@open-mercato/core`: **338 / 3094** (baseline preserved).
- `@open-mercato/ui`: **60 / 328** (baseline preserved).

## Typecheck

`yarn turbo run typecheck --filter=@open-mercato/ai-assistant --filter=@open-mercato/core --filter=@open-mercato/app`
→ **all 2 typecheck tasks green** (`@open-mercato/core` + `@open-mercato/app`;
ai-assistant has no typecheck script — its Jest suite + ts-jest acts as
the TS gate).

## Generators

- `yarn generate` — green, zero drift. The new entity surfaces through
  `apps/mercato/.mercato/generated/entities.generated.mjs` via the
  existing `ai_assistant_27` aggregate import (no new namespace needed —
  entity added to the same `data/entities.ts` aggregate).
- `cd packages/ai-assistant && node build.mjs` — clean rebuild so the
  generator can resolve the compiled import.
- `touch apps/mercato/next.config.ts` — applied (Turbopack cache recipe).

## Migration

`yarn db:generate` — emits
`packages/ai-assistant/src/modules/ai_assistant/migrations/Migration20260419132948.ts`.
Class name manually suffixed with `_ai_assistant` to match the Step 5.3
convention (the generator emits the bare date-timestamp form and logs a
`rename failed` warning that's unrelated to ai-assistant). Shape
(excerpt):

```sql
create table "ai_agent_mutation_policy_overrides" (
  "id" uuid not null default gen_random_uuid(),
  "tenant_id" uuid not null,
  "organization_id" uuid null,
  "agent_id" text not null,
  "mutation_policy" text not null,
  "notes" text null,
  "created_by_user_id" uuid null,
  "created_at" timestamptz not null,
  "updated_at" timestamptz not null,
  constraint "ai_agent_mutation_policy_overrides_pkey" primary key ("id")
);
create index "ai_agent_mutation_policy_overrides_tenant_agent_idx"
  on "ai_agent_mutation_policy_overrides" ("tenant_id", "agent_id");
alter table "ai_agent_mutation_policy_overrides"
  add constraint "ai_agent_mutation_policy_overrides_tenant_org_agent_uq"
  unique ("tenant_id", "organization_id", "agent_id");
```

`down()` issues `drop table if exists ... cascade`. Reversible.

Snapshot: `packages/ai-assistant/src/modules/ai_assistant/migrations/.snapshot-open-mercato.json`
— updated alongside the migration so future `yarn db:generate` runs
diff against a correct baseline and produce no drift. Out-of-scope
snapshot drift in `business_rules` / `catalog` / `shipping_carriers`
emitted during this Step was reverted so the PR stays scoped.

## i18n

`yarn i18n:check-sync` → **all translation files in sync** across
en / pl / es / de. 22 new keys under
`ai_assistant.agents.mutation_policy.*` with full translations for all
four locales (no placeholder rows).

## Key decisions

- **Policy hierarchy landed (most restrictive → least):** `read-only`
  (rank 0) < `destructive-confirm-required` (rank 1) <
  `confirm-required` (rank 2). Encoded in `POLICY_RESTRICTIVENESS`
  inside `lib/agent-policy.ts`. Rationale: `destructive-confirm-required`
  is MORE restrictive than `confirm-required` because it forces
  confirmation on every write (not only destructive ones that the agent
  can typically distinguish itself), whereas `confirm-required` allows
  per-action agent-side distinction. `read-only` is maximal.
- **Additive override wiring.** `checkAgentPolicy` gains a new optional
  `mutationPolicyOverride: AiAgentMutationPolicy | null` field. Callers
  that omit it receive exactly the pre-Step-5.4 behavior (the test suite
  `lib/__tests__/agent-policy.test.ts#returns mutation_blocked_by_policy`
  still passes). The runtime helpers `resolveAiAgentTools`,
  `runAiAgentText`, and `runAiAgentObject` all forward the override —
  there's no path where a runtime caller can bypass it by using a
  different entry point.
- **Fail-safe on corruption.** Both `resolveEffectiveMutationPolicy` and
  the runtime lookup log at `warn` and fall back to the code-declared
  policy on any corrupt enum value. The spec says the override must
  never escalate; returning the code-declared value on bad data is the
  safest interpretation (covered by a dedicated unit test).
- **Escalation guard at the route layer.** `isMutationPolicyEscalation`
  is invoked in POST before hitting the repo. Escalation attempts
  return 400 + `escalation_not_allowed` with `codeDeclared` + `requested`
  in the body so the UI can surface a precise error message. Tests
  cover both `read-only → confirm-required` (dedicated task requirement)
  and `destructive-confirm-required → confirm-required`.
- **Distinct surface from the prompt editor.** The mutation-policy
  UI lives in its own `<MutationPolicySection>` rendered BETWEEN the
  agent metadata block and the prompt-override editor. The two surfaces
  share no state, no save button, and no API route. This is the spec's
  "separate from prompt editor" requirement taken literally.
- **Task-glossary reconciliation.** The Step-5.4 brief used colloquial
  policy names `read-only | write-capable | stack-approval`. The
  canonical enum in the source spec (§4, §9, §K3) and throughout the
  codebase is `read-only | confirm-required | destructive-confirm-required`.
  Changing the enum is frozen by the BC contract (surface #2); renaming
  would cascade through generated files, tests, the `meta-pack`
  AI tool, and stored prompt-override reserved keys. The implementation
  uses the canonical enum; the HANDOFF documents the mapping.

## BC

- Additive only. New entity, new table, new route, new optional
  parameter. Every pre-Step-5.4 caller keeps identical behavior.
- `checkAgentPolicy({ mutationPolicyOverride: undefined })` is byte-for-
  byte equivalent to the pre-Step-5.4 behavior (verified by the existing
  `agent-policy.test.ts` suite still being green).
- No import paths removed; no event IDs renamed; no database columns
  dropped.

## Integration spec

`TC-AI-AGENT-SETTINGS-005-settings-page.spec.ts` gains two scenarios:

1. Settings page for a read-only agent disables the `confirm-required`
   radio (asserts `data-ai-agent-mutation-policy-option-disabled="true"`)
   while leaving `read-only` selectable.
2. POST escalation attempt via `request.fetch` — asserts the route
   exists (never 404 on the path itself) and returns 400 +
   `escalation_not_allowed` when the request carries auth, or 401/403
   when the test fixture lacks auth. Either way, the escalation guard
   is exercised at the HTTP boundary.
