# Pre-Implementation Analysis: Configurable CRM interaction (task) statuses

> Spec: `.ai/specs/2026-06-18-configurable-crm-interaction-statuses.md`
> PR #3231 · Issue #3230 · Date: 2026-06-18 · Scope: `customers` (`packages/core`)

## Executive Summary

**Ready to implement.** No backward-compatibility blockers and **no existing test breaks** from any
of the four mechanical changes (validator widening, counts-param reframe, new dictionary kind,
open-set broadening). The single highest-value front-loaded item is a query-index consistency
requirement on the Phase 2 projection broadening (from `.ai/lessons.md`): when the next-interaction
projection starts including `in_progress`/`waiting`, it must keep emitting `query_index.upsert_one`
for the affected `customer_entities`, or search/token filters go stale. Recommendation: fold three
implementation notes into the spec, then proceed.

## Backward Compatibility

All 13 contract surfaces checked. Only one surface is touched, and the spec already handles it.

### Violations Found
| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|-------------|
| 1 | (2) Type definitions | `interactionStatusValues` / `InteractionStatus` (validators.ts:381-382) stop being the validation source | Warning | **Already in spec** — keep both exported, add `@deprecated`, do not remove or change contents. Compliant with the deprecation protocol. |
| 2 | (1) `data/validators.ts` "MUST NOT remove or narrow existing schemas" | `status` goes `z.enum(...)` → `z.string().max(50)` | None (allowed) | This is a **widening** (accepts a superset). The rule forbids *narrowing*; widening is non-breaking and explicitly allowed. |
| 3 | (7) API routes | `counts` route `status` param adds `open` | None (additive) | Keep `planned`/`done` accepted; add `open`. Additive per the API-route rules. `openApi` already exported (counts/route.ts:34). |
| 4 | (8) DB schema | none | None | No column/table change; `status` stays `text`. |
| 5 | (10) ACL feature IDs | none | None | Reuses `customers.settings.manage`; no new feature ID. |

### Missing BC Section
None. The spec has a "Backward compatibility & migration" section covering the deprecation bridge,
the widening, row handling, the existing-tenant upgrade action, and "no DB migration / no new ACL".

## Spec Completeness

All required sections present (TLDR, Overview, Problem, Proposed Solution, Architecture, Data model,
API contracts, Risks & Impact Review, Phasing, Implementation Plan, Integration Test Coverage, Final
Compliance Report, Changelog).

### Incomplete Sections
| Section | Gap | Recommendation |
|---------|-----|---------------|
| Implementation Plan — Phase 2, step 4 | Broadening `interactionProjection.ts` changes which interactions feed the denormalized `next_interaction_*` fields on `customer_entities` (query-indexed). The step does not mention re-emitting the query index upsert. | Add: "preserve/verify `query_index.upsert_one` emission for affected `customer_entities` when the projection set changes (per `.ai/lessons.md` → 'Projection updates that change indexed parent fields must emit query-index upserts'). Verify ordering / NULL-`scheduledAt` handling now that non-scheduled open statuses (in_progress/waiting) can enter the projection." |
| Risks & Impact Review | Two implementation-specific risks below are not yet listed (R6, R7). | Add them. |

## AGENTS.md Compliance

No violations. Spot checks:
- **Canonical primitives** — reuses `makeCrudRoute` (interactions route already does), the existing
  dictionary CRUD route/commands, `CrudForm` for the status picker, `StatusBadge` for rendering,
  `apiCall` via the existing dictionary hook. No DIY substitutes.
- **No raw writes** — the task status picker lives in `CrudForm`; per `.ai/lessons.md` → "Detail
  sections must route writes through page-level guarded mutations", any non-`CrudForm` status write
  from a detail section MUST use `useGuardedMutation`. Flag for the implementer (no current spec step
  proposes a raw write).
- **i18n** — new `<select>` option labels and the management-section titles must use `useT()` keys.
  The hardcoded-string checker is advisory (exit 0) and excludes tests/i18n dirs, so it will not
  fail CI, but house convention requires keys. Note in Phase 4.
- **Design System** — `StatusBadge` + `mapDictionaryColorToTone`; seeded hex `color`s are dictionary
  data (DB), not Tailwind classes — same as `DEAL_STATUS_DEFAULTS`. Compliant.
- **Encryption** — N/A; `status` is not PII.
- **Events / commands** — reuses existing undoable interaction commands and existing interaction
  events (`completed`/`canceled`/`reverted`); no new event ID, no new mutation.

## Risk Assessment

### High Risks
None.

### Medium Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| **R6 — Query-index staleness on projection broadening.** Broadening `interactionProjection.ts` to include in_progress/waiting changes `next_interaction_*` on `customer_entities` without an index upsert → grids show fresh values but global search / token filters stay stale (the exact failure in `.ai/lessons.md`). | Search/list inconsistency for the next-step fields. | Emit `query_index.upsert_one` for affected entities in the same path; add an integration assertion that an in_progress interaction updates the indexed `next_interaction_*`. |
| **R3 — Existing tenants without the seeded dictionary** (already in spec) | Empty status dropdown until the upgrade action runs. | Phase 5 idempotent upgrade action; lenient validation keeps the API working meanwhile. |

### Low Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| **R7 — Next-interaction ordering when in_progress/waiting lack `scheduledAt`.** The projection orders by `scheduledAt`; non-scheduled open tasks may sort oddly or surface NULL. | "Next step" may pick an unscheduled in_progress task over a scheduled planned one, or vice-versa. | Decide ordering explicitly (e.g. scheduled-first, then by createdAt); add a unit test for the mixed case. |
| **R1 — Split-brain open definitions** (already the spec's tracked primary risk) | Started task vanishes from a positive `= 'planned'` filter. | Single helper + Phase 2 call-site audit + enumerating unit test. |

## Gap Analysis

### Critical Gaps (block implementation)
None.

### Important Gaps (should address — fold into spec before Phase 2)
- **Query-index upsert on projection broadening** (R6) — see Incomplete Sections.
- **Projection ordering / NULL `scheduledAt`** (R7) — define the intended "next step" ordering once
  in_progress/waiting are eligible.

### Nice-to-Have Gaps
- **Positive test coverage** for the widened `z.string()` status and the new `open` counts bucket.
  The two status-coupled test files (`data/__tests__/interactionSchemas.test.ts`,
  `__tests__/validators.test.ts`) currently pass through unchanged; add cases there.
- **AI tool spelling fix** — `ai-tools/activities-tasks-pack.ts:241` maps done→`'completed'` and uses
  `'cancelled'` (double-L) vs stored `'done'`/`'canceled'`; Phase 5 should align spelling, not just
  widen the enum. (Pre-existing latent mismatch, not introduced here.)

## Test-Impact Findings (verified against the codebase)

- **Nothing breaks.** No test asserts interaction-status rejection; none pins `interactionStatusValues`
  contents/length; the counts tests never pass `status`; `seedDictionaryScope.test.ts` does not assert
  the seeded-kind set; no test pins `KIND_MAP` / `BUILTIN_DICTIONARY_ROUTE_KINDS` membership.
- `interactionParticipantSchema.status` is already `z.string().trim().max(50)` (validators.ts:388) —
  unaffected by the interaction-level widening; do not confuse the two.
- `ActivityHistorySection.test.tsx:63` asserts `status` is null on the **list** route (already
  `z.string().optional()`), not the counts route — unaffected by the counts reframe.
- `enrichers.test.ts` operates on a pre-computed count map and never asserts the status list —
  changing the terminal set does not break it.
- `openApi` confirmed on both `api/interactions/route.ts:680` and `api/interactions/counts/route.ts:34`.

## Remediation Plan

### Before implementation (must do)
1. Fold R6 (query-index upsert on projection broadening) into Phase 2 step 4 of the spec.
2. Fold R7 (projection ordering / NULL `scheduledAt`) decision into the spec.

### During implementation (add to spec / honour)
1. Add positive test cases for widened status + `open` counts bucket in the two status-coupled test files.
2. Keep the task status picker in `CrudForm`; if any detail section writes status directly, use `useGuardedMutation`.
3. Phase 5: align AI tool status spelling (`completed`→`done`, `cancelled`→`canceled`) while widening.

### Post-implementation (follow up)
1. `dispatch-crm` MCP (separate repo): add `update_task` / `set_task_status` so the agent can set in_progress/waiting/canceled.
2. Optional backfill of legacy `completed` rows → `done`.

## Recommendation

**Ready to implement** after folding R6 and R7 into the spec (both are small, additive notes — done
in this prep pass). No major revision needed. Implement with `om-implement-spec` or
`om-auto-fix-github 3230`; Phase order as written. The contract-surface touch is limited to the
already-bridged `interactionStatusValues` export.
