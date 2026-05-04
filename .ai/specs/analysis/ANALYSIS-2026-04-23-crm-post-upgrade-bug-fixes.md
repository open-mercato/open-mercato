# Pre-Implementation Analysis: CRM Post-Upgrade Bug Fixes

**Spec analyzed:** [.ai/specs/2026-04-23-crm-post-upgrade-bug-fixes.md](.ai/specs/2026-04-23-crm-post-upgrade-bug-fixes.md)
**Analysis date:** 2026-04-23
**Analyzer:** pre-implement-spec skill
**Current spec state:** Skeleton (Draft) + 8 gating Open Questions

---

## Executive Summary

The spec is intentionally a **skeleton with 8 Open Questions** that gate all detailed design. By design, no `Implementation Phases` content has been drafted. The skeleton is **architecturally sound** (scoped to a single module, explicit Non-Goals for contract surfaces, BC contract referenced), but it **cannot be implemented as-is**: every phase's "approach depends on Qn".

Verification against the live codebase confirms most of the spec's factual claims (see "Claim Verification" below). Three findings should be pulled forward **before** the user answers the Open Questions:

1. **Q2 option (c) — `relatedResourceIds` on `action_logs` — requires a migration + backfill plan that's not yet acknowledged.** `action_logs` has no such column today; adding it is additive (BC-safe) but needs an index, a subscriber to double-write during the bridge period, and a strategy for historical comments whose deal linkage lives in `snapshotAfter`. Option (d) (filter by `snapshotAfter.dealId`) is cheaper but only works if the jsonb column is indexed for that path.
2. **Q3 is partially disprovable from code inspection alone.** The literal string "undo token not available" does **not** appear in `interactions.ts`. The reporter's error surfaces from a different layer (likely `VersionHistoryPanel` / global undo chip). Preview repro is mandatory — the spec already gates on it, which is correct.
3. **Q4 option (a) is not the real bug.** `usePersistedBooleanFlag` *does* persist correctly with an SSR-safe mounted-ref guard. The "always fully expanded after refresh" symptom is almost certainly either (i) wrong `pageType` key per entity so state is scoped to the wrong page, (ii) the hook reading `defaultValue=false` on first render and taking a tick to hydrate — visible as a flash. The spec should be written to **first reproduce and measure**, not to assume the hook is broken.

**Recommendation:** Before answering Q1-Q8, run a focused **preview repro pass** on Q3 (undo), Q4 (persistence key audit), Q6 (dictionary editor path), and Q8 (which filter broke). That pass will shorten all remaining phases and change at least one Open Question's premise.

**Readiness:** Needs spec updates first — Open Questions + repro before implementation starts. BC surface coverage in Non-Goals is good but must be made active (per-phase) once phases expand.

---

## Claim Verification (spec vs. live code)

| # | Spec claim | Verified? | Notes |
|---|-----------|-----------|-------|
| Q2 | `entityId` is required on comments, `dealId` branch never fires | ✅ **Confirmed** | `commentCreateSchema` at [validators.ts:161-173](packages/core/src/modules/customers/data/validators.ts) has no `.optional()` on `entityId`. `resolveParentResourceKind` ([commands/shared.ts:197](packages/core/src/modules/customers/commands/shared.ts)) only returns `customers.person`\|`customers.company`. Deal branch is dead. |
| Q2 | ChangelogTab queries `?resourceKind=customers.deal&resourceId=<dealId>&includeRelated=true` | ✅ **Confirmed** | [ChangelogTab.tsx:184-186](packages/core/src/modules/customers/components/detail/ChangelogTab.tsx) |
| Q3 | `buildLog` returns same shape for past vs scheduled activities | ⚠️ **Partially** | Create-buildLog captures `{ after: snapshot }` only. Complete-buildLog captures `{ before, after }`. Shared fields (actionLabel/resourceKind/parentResource/tenantId/organizationId) are identical. |
| Q3 | Error is "undo token not available" | ❌ **Not found in code** | String does not exist in `interactions.ts` or the customers module. Must come from a generic component (VersionHistoryPanel / global undo). **Preview repro required**. |
| Q4 | `useZoneCollapse` + `usePersistedBooleanFlag` persist to localStorage | ✅ **Confirmed** | [usePersistedBooleanFlag.ts:17-28](packages/ui/src/backend/crud/usePersistedBooleanFlag.ts); SSR-safe via `mounted` ref. Key: `om:zone1-collapsed:${pageType}`. |
| Q4 | Zone 2 tab sections don't persist state | ✅ **Confirmed** | `ActivitiesSection`, `PlannedActivitiesSection`, `DealsSection`, `TasksSection`, `ChangelogFilters`, `CompanyPeopleSection`, `RolesSection` do not use the shared hooks. |
| Q5 | `RoleAssignmentRow:144` renders `role.userName ?? role.userEmail ?? role.userId` | ✅ **Confirmed** | [RoleAssignmentRow.tsx:144](packages/core/src/modules/customers/components/detail/RoleAssignmentRow.tsx) |
| Q5 | `userName` flow in API factory | ⚠️ **Refined** | [entity-roles-factory.ts:316-326](packages/core/src/modules/customers/api/entity-roles-factory.ts) maps from `User.name` — a single denormalized column, **not** `first_name + last_name`. Q5 option (a)'s sub-claim ("or first_name + last_name") is wrong for the current schema. |
| Q7 | InlineActivityComposer textarea is `rows={1}`, `min-h-[44px]` | ✅ **Confirmed** | [InlineActivityComposer.tsx:194-201](packages/core/src/modules/customers/components/detail/InlineActivityComposer.tsx) |
| Q7 | ScheduleActivityDialog already uses `SwitchableMarkdownInput` | ✅ **Confirmed** | [ScheduleActivityDialog.tsx:425-432](packages/core/src/modules/customers/components/detail/ScheduleActivityDialog.tsx) |
| Q7 | Neither composer embeds `undoToken` in flash | ✅ **Confirmed** | Neither composer passes an undo action through `flash()`. Q3 hypothesis (a) is plausible. |
| Q8 | Deal list URL sync doesn't include `advancedFilterState` | ✅ **Confirmed** | [deals/page.tsx:699-710](packages/core/src/modules/customers/backend/customers/deals/page.tsx) only syncs `search`, `personId`, `companyId`, `page`. Spec says line 698 — actually 699. |
| Q8 | Dictionary columns' `filterKey` diverges from API field name | ✅ **Confirmed** | Column `filterKey='pipeline_stage'` / `'status'` / `'pipeline_id'` at lines 909-929, but deal API params are camelCase elsewhere. Round-trip needs verification. |
| Q1 | CRM detail headers are bespoke; sales uses shared `FormHeader detail` | ✅ **Confirmed** | Person/Company/Deal detail headers render custom card markup (no `FormHeader` import). Sales document detail page imports and uses `FormHeader mode="detail"` with `utilityActions`. |

**Net effect:** Q2, Q5 (partially), Q7, Q8 can proceed to design with current facts. Q1, Q4 need a pageType audit. Q3 is blocked on preview repro. Q6 is purely UX-design and needs user input.

---

## Backward Compatibility

### Contract Surface Inventory (affected)

| BC # | Surface | Items in scope today | Risk in this spec |
|------|---------|---------------------|-------------------|
| 1 | Auto-discovery | `events.ts`, `notifications.ts`, `acl.ts`, `setup.ts` | None — spec doesn't touch convention files |
| 2 | Type interfaces | `EventDefinition`, `InjectionWidgetComponentProps`, `PageMetadata` | Q1 (b) could touch widget spot context if CRM migrates to `FormHeader` injection spots — additive only |
| 5 | Event IDs | 50+ customers events (see Appendix A) | Non-Goals forbid changes. Risk is **accidental** payload-shape change in Phase 2 if comment `snapshotAfter` gains a `dealId` mirror |
| 6 | Widget spot IDs | `form-header:detail`, `form-header:edit` (from `FormHeader`); no CRM-detail-specific spots today | Q1 (b) would add a new injection spot for the identity block — additive; Q1 (c) changes `FormHeader` usage only, additive |
| 7 | API routes | `/api/customers/entity-roles/<type>/<id>`, `/api/audit_logs/audit-logs/actions` | Q5 (a) derives a `userName` server-side — additive; Q2 (c) adds `relatedResourceIds` to response — additive |
| 8 | DB schema | `action_logs` has 22 columns today; no `relatedResourceIds` | Q2 (c) = additive column + index. Q2 (d) is no-op. **Non-Goals correctly forbid rename/remove of any `action_logs` column.** |
| 10 | ACL feature IDs | `customers.roles.view`, `customers.roles.manage`, `customers.settings.manage` | No rename risk in current phases. Q6 link target must respect `customers.settings.manage` (use `hasFeature` wildcard-aware matcher per lessons). |
| 11 | Notification type IDs | `customers.deal.won`, `customers.deal.lost` | Not in scope. |
| 12 | CLI commands | N/A | Not in scope. |

### Violations Found

| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|-------------|
| — | — | **No violations** in the current skeleton. The spec explicitly calls out additive-only rules in Non-Goals and references BC contract #2/#7/#8. | — | Keep the Non-Goals paragraph verbatim when expanding phases. |

### Missing BC Section

The spec **does not include a "Migration & Backward Compatibility" section** in its own body. The BC contract requires this for any PR that modifies a contract surface (BC doc §Deprecation Protocol #5). At least **Phase 2 (Q2 option c)** and **Phase 5 (Q5 option a)** touch the API/DB response shape and therefore need such a section.

**Action:** When Open Questions are resolved and phases expand, add a top-level section titled "Migration & Backward Compatibility" that lists each contract surface touched, whether the change is additive or deprecated, and the bridge window. See [BACKWARD_COMPATIBILITY.md](BACKWARD_COMPATIBILITY.md) for the required structure.

### Option-by-option BC verdict

| Question | Option | BC verdict | Notes |
|----------|--------|-----------|-------|
| Q1 | (a) bespoke header + icons | **BC-safe (additive)** | Adds `SendObjectMessageDialog` + `VersionHistoryAction` usage only |
| Q1 | (b) migrate to `FormHeader detail` | **BC-safe (additive spots)** but **UI-risky** | Must preserve all existing `form-header:detail` injection consumers; mobile/collapsed-zone rail is a regression vector |
| Q1 | (c) hybrid | **BC-safe** | Lowest-risk shipping path |
| Q2 | (a) single log, prefer `customers.deal` | **BC-safe for writes**; **UX-breaking for person/company changelog** | Historical logs already filed under person/company need a retro-fit strategy |
| Q2 | (b) two log entries | **BC-safe**; **undo risk** | Double undo tokens per comment; `commandId` uniqueness gets tricky |
| Q2 | (c) add `relatedResourceIds: string[]` | **BC-safe (additive)** | **New column + migration + backfill + index** required. Must dual-write during bridge. |
| Q2 | (d) server-side filter on `snapshotAfter.dealId` | **BC-safe**; performance-sensitive | Requires GIN or jsonb_path_ops index on `snapshotAfter`; fallback to sequential scan if missing |
| Q3 | (a) UI-only flash fix | **BC-safe** | Additive flash action |
| Q3 | (b) re-sequence commit in backend | **BC-risky** — must preserve `emitCrudSideEffects` ordering per [command lessons](.ai/lessons.md) | Touches audit_logs side-effect path |
| Q3 | (c) both | **Same as (b)** | |
| Q4 | (a)-(d) scope | **BC-safe** | New localStorage keys must not collide with existing `om:zone1-collapsed:*` |
| Q4 | (e) DB persistence | **BC-risky** — new table `user_ui_prefs` or extending `auth_users.preferences` | New table is additive. Extending existing JSON column is additive only if field name is new. |
| Q5 | (a) API derives `userName` | **BC-safe (additive field behavior)** | Response field already exists and is `string\|null`; only the population rule changes |
| Q5 | (b) client fallback | **BC-safe** | |
| Q5 | (c) enforce non-null | **BC-breaking** — narrows the field's nullability — **BLOCKED by BC contract #2** | Cannot narrow required-field types |
| Q6 | (i) rename section | **BC-safe (UI copy only)** | Watch for translation key changes — keys are not a BC surface but are a contract for third-party translators |
| Q6 | (ii) dictionary editor link | **BC-safe** | Target path `/backend/config/customers/...` must be verified in preview |
| Q7 | (a) rework `InlineActivityComposer` | **BC-safe (internal component)** | Component is module-private |
| Q7 | (iii) swap `MiniWeekCalendar` for platform `DatePicker` | **BC-safe**; **visual regression risk** | MiniWeekCalendar may have inline features (week preview, scheduling density) that DatePicker lacks |
| Q8 | (a) switch to `type: 'select'` filter | **BC-safe (DataTable feature)** | URL-state shape for the filter may change; verify no external docs reference it |
| Q8 | (b) normalize `filterKey` to camelCase | **Depends on API input validators** — if deals API accepts both `pipeline_stage` and `pipelineStage`, additive; otherwise the mismatch is the bug and fixing it is the fix |
| Q8 | (c) sync `advancedFilterState` to URL | **BC-safe** | Must pick a stable URL param name (e.g. `af=`) that won't collide with existing query keys |
| Q8 | (d) all | **See above** | |

---

## Spec Completeness

The spec is **intentionally a skeleton per the spec-writing SKILL.md step 3**, which requires stopping after the Open Questions block. This is correct procedure, so "missing sections" below should be interpreted as **sections that must be filled after Open Questions resolve**, not as deficiencies in the skeleton itself.

### Sections present (skeleton)

- TLDR ✅
- Open Questions ✅ (gating)
- Problem Statement ✅
- Proposed Solution (high-level, phase list) ✅
- Non-Goals ✅
- Dependencies & References ✅
- Implementation Phases — placeholder ⚠️ (expected)
- Changelog ✅

### Sections to add when phases expand

| Section | Impact if omitted | Recommendation |
|---------|-------------------|---------------|
| Architecture | Third-party devs can't reason about cross-module impact | One subsection per phase describing the fix shape (UI-only / backend-only / schema-add / contract-add) |
| Data Models | Phase 2 option (c) adds a column; without a data-model section a reviewer can't validate the migration | Required for Phase 2 if Q2=(c). Also required for Q4=(e). |
| API Contracts | Phase 2 and Phase 5 may change response field semantics | Document whether `userName` becomes always non-null (it must not per BC#2), whether response adds `relatedResourceIds`, etc. |
| UI/UX | Phases 1, 4, 5, 6 are mostly UI | Phase 1 needs before/after sketches or Figma IDs; Phase 6 needs the composer layout decision from Q7 |
| Risks & Impact Review | No failure-scenario coverage today | List: header visual regression on mobile, double-undo on Q2=(b), jsonb index regression on Q2=(d), flash race on Q3=(b) |
| Phasing | Listed at high level | Break each phase into Goal / Steps / API-DB-UI / Tests / Rollback / BC notes per spec template |
| Implementation Plan | "Placeholder — do not implement" | Expand after gate |
| Integration Test Coverage | Mentioned but not enumerated | Must list one `TC-*` per phase, per `.ai/qa/AGENTS.md` |
| Final Compliance Report | Not present | Add before freezing the spec |
| Migration & Backward Compatibility | **Missing** — required by BC contract if Phase 2=(c), Phase 4=(e), or Phase 5=(a) ship | Add if any of those options are selected |

---

## AGENTS.md Compliance

This spec is a bug-fix bundle. Compliance checks focus on which AGENTS.md guides apply and whether the skeleton's claims/scope respect them.

### Module structure & placement

- ✅ All affected code sits in `packages/core/src/modules/customers/` and `packages/ui/src/backend/crud/` — correct per root AGENTS.md.
- ✅ No new module is being created; existing auto-discovery paths remain untouched.
- ✅ Non-Goals correctly forbid rewrites of `ChangelogTab`, `AssignRoleDialog`, `ScheduleActivityDialog`, `DataTable`.

### Commands & undo (Q2, Q3)

- **Lesson applies** ([.ai/lessons.md](.ai/lessons.md) §"Avoid identity-map stale snapshots in command logs"): if Q2=(d) is chosen (server-side filter by `snapshotAfter.dealId`), the comments' `buildLog` must already capture `dealId` in the `after` snapshot **using a forked EM or `refresh: true`**. Confirm this in Phase 2 before implementing.
- **Lesson applies** (§"Flush entity updates before running relation syncs"): not relevant to any of these phases as currently scoped.
- Q3 option (b) directly touches the `emitCrudSideEffects` ordering. Root AGENTS.md requires "Both `emitCrudSideEffects` and `emitCrudUndoSideEffects` include `indexer: { entityType, cacheAliases }`" — Phase 3 must preserve this when re-sequencing.

### UI conventions (Q1, Q7)

- **Lesson applies** ([.ai/lessons.md](.ai/lessons.md) §"Detail sections must route writes through page-level guarded mutations"): any Phase 6 composer rework must keep `useGuardedMutation` ownership on the page and consume it in the composer. Do not introduce raw `apiCall` inside the composer.
- **Design-System rules apply** (root AGENTS.md):
  - `FormHeader` with `utilityActions` for detail pages (Q1) — options (b) and (c) align with platform parity.
  - Every dialog MUST have `Cmd/Ctrl+Enter` submit + `Escape` cancel — verify on the reworked composer (Q7) if it gains a dialog shell.
  - No hardcoded user-facing strings — all new labels (section rename, help tooltip, dictionary editor link) must use `useT()`.
  - `LoadingMessage`/`ErrorMessage` — if Phase 5 adds a fetch for dictionary role types, use these for loading/error states.
  - `<StatusBadge>` — not relevant here, but if any role type gets a colored tag, use the status token pattern.

### RBAC / feature-gating (Q6)

- **Lesson applies** ([.ai/lessons.md](.ai/lessons.md) §"Feature-gated runtime helpers must use wildcard-aware permission matching"): the dictionary-editor deep link (Q6 (ii)) must gate visibility via `hasFeature('customers.settings.manage')`, not an exact-match `includes('customers.settings.manage')`. Use the shared wildcard-aware matcher so grants like `customers.*` still show the link.
- **Lesson applies** (§"Never guard sensitive routes with `requireRoles`"): if Phase 5 or Phase 6 adds a new settings page, declare its guard via `requireFeatures` with an immutable feature ID from `acl.ts`.

### Data & security

- **BC surface #8**: `action_logs` changes (Q2 option c) require `yarn db:generate` — never hand-written migrations. Add the column with a `NULL` default and backfill via subscriber, per the BC doc §8 rule "MAY add new columns with defaults (non-breaking)".
- **Encryption**: none of the phases touch PII fields; `findWithDecryption` rule is not triggered here. Exception: the role API already calls `User.name` — Phase 5 option (a) must continue to use `findWithDecryption` (or equivalent) when joining `auth_users`.

### Events

- Phase 2 may need a new event `customers.comment.parent_resolved` if Q2=(c) requires a subscriber to backfill existing comments. If added, declare it via `createModuleEvents()` + `yarn generate`; document in BC #5 as additive.

### Integration tests (hard requirement from root AGENTS.md)

- Root AGENTS.md: "For every new feature, implement the integration tests defined in the spec as part of the same change."
- `.ai/qa/AGENTS.md` (inferred path): every phase needs at least one `TC-*` Playwright spec.
- **Lesson applies** ([.ai/lessons.md](.ai/lessons.md) §"Integration tests: avoid networkidle on pages with SSE/background streams"): CRM detail pages stream via SSE — tests must not use `waitForLoadState('networkidle')`.

---

## Risk Assessment

### High Risks

| Risk | Affected phase | Impact | Mitigation |
|------|---------------|--------|-----------|
| **Q2 option (c) `relatedResourceIds` migration affects every existing tenant's `action_logs`** | Phase 2 | Long-running migration, jsonb scan cost, potential write amplification during backfill | Ship as background backfill subscriber, not an inline migration. Add GIN index on `snapshotAfter` first (non-blocking). Document bridge period (dual-write new + old schema) of ≥1 minor version. |
| **Q1 option (b) full migration to `FormHeader`** regresses CRM-specific identity block on mobile + collapsed-zone rail | Phase 1 | Visual regression on the most-used screen family | Pick option (c) hybrid unless preview shows identity block can be cleanly reinjected. Require Playwright visual-diff coverage for mobile viewport. |
| **Q3 option (b) re-sequencing backend event emission** could break existing subscribers that rely on current ordering | Phase 3 | Silent regression in unrelated CRM event consumers | Preview repro first (the spec already gates on this — good). If UI-only (a) resolves the bug, skip (b). |
| **Q8 URL param collision** if `advancedFilterState` is synced under a name that matches an existing query key on deals | Phase 6 | Filters lost on refresh; links break for bookmarked queries | Choose an explicit prefix (e.g., `af=`) and add a round-trip unit test |

### Medium Risks

| Risk | Affected phase | Impact | Mitigation |
|------|---------------|--------|-----------|
| `ChangelogTab` semantics shift if Q2=(a) | Phase 2 | Comments disappear from person/company changelog — user-visible behavior change | Explicit release note + maybe a UI toggle to "include deal-scoped notes" |
| SSR hydration flash on Q4 fixes | Phase 4 | Collapsed sections briefly show expanded before localStorage hydrates | Accept the flash (already present today) **or** snapshot state on first client render before paint via `useLayoutEffect` — document choice |
| Translation coverage missing for renamed role section (Q6 (i)) | Phase 5 | Non-English users see English fallback | Update all locale files in the same PR per root AGENTS.md |
| Mismatched `filterKey` vs API param (`pipeline_stage` vs `pipelineStage`) is a **two-sided contract** bug — fixing one side breaks saved filter URLs | Phase 6 | Users' saved filters break silently | Accept both names server-side (additive) for one release, then normalize |

### Low Risks

| Risk | Affected phase | Impact | Mitigation |
|------|---------------|--------|-----------|
| New injection spots from Q1 aren't discovered by existing third-party widgets | Phase 1 | No impact — additive | Document new spot IDs in widget injection docs |
| `SwitchableMarkdownInput` in reworked `InlineActivityComposer` behaves differently on Cmd+Enter than the one-row textarea | Phase 6 | UX inconsistency between "quick log" and "full schedule" | Decide explicitly whether quick-log keeps plain textarea or gains markdown toggle |

---

## Gap Analysis

### Critical Gaps (block implementation)

- **Preview repro for Q3**: The literal error string "undo token not available" is not in the codebase. Phase 3 cannot start without a reproducer that pins the exact call path.
- **Preview repro for Q8**: The user's screenshot is silent on which filter broke. Spec explicitly asks "Please tell us which filter you tried" — this must be answered before Phase 6 designs a fix.
- **`pageType` key audit for Q4**: Before choosing options (a)-(e), run a grep for `useZoneCollapse(` and `usePersistedBooleanFlag(` in the `customers` module and confirm each detail page passes a **stable, per-entity-kind** `pageType`. The most likely root cause of "always fully expanded" is a colliding or per-mount-dynamic key.
- **Dictionary editor target path for Q6**: Spec says "verify path in preview". Without the real URL, Phase 5's "deep-link" option can't be implemented.
- **"Migration & Backward Compatibility" section**: BC contract requires it; currently absent.

### Important Gaps (should address before expanding phases)

- **Integration test list** per phase is mentioned but not enumerated. Phases cannot ship without this per `.ai/qa/AGENTS.md`.
- **Rollback strategy** per phase: Phase 2 especially needs a written rollback (disable subscriber + keep column nullable).
- **Bridge period for Phase 2 + Phase 5**: If Q2=(c), Q5=(a), or Q4=(e) are selected, declare the minor-version bridge window in the spec.
- **Cache invalidation**: Q5 option (a) changes `entity-roles` API response. If this API is cached (check `packages/cache` usage), list the invalidation tags.
- **ACL feature used for dictionary editor link (Q6 (ii))**: likely `customers.settings.manage` — confirm, and use the wildcard-aware matcher.
- **Translation keys to add**: section rename (Q6), help tooltip (Q6), new icon tooltips (Q1), composer labels (Q7), flash messages with undo (Q3).

### Nice-to-Have Gaps

- **Visual-regression test coverage** for Phase 1 (headers) — not required but strongly recommended given the blast radius.
- **Benchmark** for Q2=(d) jsonb filter cost before committing to the approach.
- **UX research signal** for Q6 section rename — "Stakeholders" vs "Key contacts" vs "Account team" is a naming decision that could warrant one round of user feedback.

---

## Remediation Plan

### Before Implementation (MUST DO)

1. **Answer Q1–Q8** in-spec with the `Aₙ:` inline pattern, per spec-writing SKILL.md.
2. **Run preview repro pass** for Q3 (undo), Q4 (pageType audit), Q6 (dictionary editor path), Q8 (which filter). Record findings in the spec under a new "Repro Notes" subsection.
3. **Correct Q5 wording**: the fallback "`first_name + last_name`" is not how the current schema models it — `User.name` is a single column. Rephrase Q5 (a) to match reality or have the user confirm schema change.
4. **Add "Migration & Backward Compatibility" section** to the spec body (currently only referenced in Non-Goals and Dependencies). List per-phase contract-surface impact with bridge windows.
5. **Enumerate integration tests** per phase in a "Integration Test Coverage" section, following `.ai/qa/AGENTS.md` TC-\* naming.

### During Implementation (add to spec as phases expand)

1. **Phase 2 (if Q2=c)**: Write out migration + backfill subscriber + jsonb index as separate steps. Add rollback = "column stays NULL, subscriber disabled, filter falls back to current path".
2. **Phase 2 (if Q2=d)**: Add a step to introduce a jsonb GIN index on `snapshotAfter` scoped to deal lookups. Benchmark with 1M+ rows before committing.
3. **Phase 3**: Document whether UI-only (a) is sufficient before touching backend sequencing (b). If (b), explicitly call out `emitCrudSideEffects` + `emitCrudUndoSideEffects` ordering per AGENTS.md §Commands.
4. **Phase 4**: Add an "Audit pageType keys" step at the start — likely resolves the bug without hook changes.
5. **Phase 5 (Q5=a)**: Server-side `userName` derivation from email local-part must use `findWithDecryption` if any PII field is involved. Document the fallback pattern.
6. **Phase 6 (Q7)**: Decide quick-log markdown support explicitly. Ensure `useGuardedMutation` ownership stays on the page.
7. **Phase 6 (Q8)**: Spec the URL param name for `advancedFilterState`; add a round-trip test.

### Post-Implementation (follow-up tasks)

1. **Consolidate the two patterns**: Either migrate all CRM detail headers to shared `FormHeader` (if Q1=b chosen) or document that CRM detail headers will remain bespoke going forward. Today's dual-pattern is the root of the user's "looks different" complaint.
2. **Audit other modules for the same `pageType` key mistake** (Phase 4 lesson) — sales, catalog, webhooks, etc.
3. **Update `.ai/lessons.md`** with any new invariants discovered (e.g., "Role-assignment display must derive `userName` server-side with an email-local-part fallback" if Q5=a).
4. **Widget injection documentation** if any new spot IDs are added (Q1 option b/c).

---

## Final Recommendation

**Status: Needs spec updates first.**

The skeleton is correctly structured per the spec-writing skill's "stop after Open Questions" gate. It is **not implementable today**, and that is the intended state. Before the gate unblocks:

- ✅ The Non-Goals paragraph is strong — preserve it verbatim.
- ⚠️ Q5 factual premise has a minor error (`first_name + last_name` vs single `name` column). Fix before answering.
- ⚠️ Q3 needs preview repro before choosing (a)/(b)/(c).
- ⚠️ Q4 needs a pageType key audit; the hook itself is probably fine.
- ⚠️ Q8 needs the user to name the broken filter.
- ✅ Every option against each Open Question has been evaluated for BC impact — no option is blocked outright except **Q5 option (c)** (narrows a nullable field's type — violates BC #2).

Once those are addressed and phases expand, re-run this analysis over the filled spec.

---

## Appendix A — Customer Events Inventory (BC #5)

Preserved via `events.ts`. Any rename/removal = BREAKING.

```
customers.person.{created,updated,deleted}
customers.company.{created,updated,deleted}
customers.deal.{created,updated,deleted,won,lost}
customers.comment.{created,updated,deleted}
customers.address.{created,updated,deleted}
customers.activity.{created,updated,deleted}
customers.tag.{created,updated,deleted,assigned,removed}
customers.todo.{created,updated,deleted}
customers.interaction.{created,updated,completed,canceled,reverted,deleted}
customers.next_interaction.updated
customers.entity_role.{created,updated,deleted}
customers.label.{created,updated,deleted}
customers.label_assignment.{created,updated,deleted}
customers.person_company_link.{created,updated,deleted}
```

## Appendix B — `action_logs` Columns (BC #8)

No column may be renamed or removed. `snapshotAfter` (jsonb) is the most likely extension surface for Q2 option (d).

```
id, tenant_id, organization_id, actor_user_id,
command_id, action_label, action_type,
resource_kind, resource_id,
parent_resource_kind, parent_resource_id,
execution_state, undo_token,
command_payload, snapshot_before, snapshot_after,
changes_json, changed_fields, primary_changed_field,
context_json, source_key,
created_at, updated_at, deleted_at
```

Today: **no `related_resource_ids` column**. Q2 (c) adds one. Must be additive with NULL default.

## Appendix C — Lessons Applied (from `.ai/lessons.md`)

- "Avoid identity-map stale snapshots in command logs" → Phase 2 must use forked EM in `buildLog`.
- "Flush entity updates before running relation syncs" → Not directly applicable.
- "Feature-gated runtime helpers must use wildcard-aware permission matching" → Phase 5 Q6 (ii) dictionary-link visibility.
- "Never guard sensitive routes with `requireRoles`" → Any new settings page from Phase 5.
- "Detail sections must route writes through page-level guarded mutations" → Phase 6 composer rework.
- "Integration tests: avoid `networkidle` on pages with SSE/background streams" → All integration tests for CRM detail pages.
- "Projection updates that change indexed parent fields must emit query-index upserts" → If Phase 2 writes extra projection data, review query-index impact.
