# Pre-Implementation Analysis: CRM Calendar (`.ai/specs/2026-06-11-crm-calendar.md`)

Analysis date: 2026-06-11. Every factual claim below was verified against the actual code in this worktree (file:line references included).

## Executive Summary

The spec's core premise holds: the existing `GET /api/customers/interactions` route genuinely supports everything the calendar needs (`from`/`to` on `coalesce(occurred_at, scheduled_at, created_at)`, cursor pagination, and a response that already returns `updatedAt`, `participants`, `location`, `allDay`, `durationMinutes`, `recurrenceRule`, `appearanceColor`, `ownerUserId`). No BC surface is touched; all changes are additive. However, **four spec claims are factually wrong against the codebase** and must be corrected before implementation: (1) the `pageGroup: 'General'` placement has no precedent and cannot land "directly under Dashboard" without touching a shared auth-module file; (2) server-side `?search=` is a silent no-op on default deployments because interaction `title`/`body` are encrypted at rest and encryption defaults ON; (3) the recurrence subset is wrong — the platform's own scheduling dialog stores `FREQ=WEEKLY;BYDAY=...` rules which the spec's pinned subset (and the reusable `expandRecurringItems`) would mis-render; (4) the dictionary seed lives in `cli.ts`, not `lib/dictionaries.ts`. Verdict: **READY WITH CORRECTIONS** — no architectural rework needed, but the spec text must be amended on these points and one open design decision (reuse `ScheduleActivityDialog` vs. new CrudForm dialog) should be resolved explicitly.

## Verified Claims (spec <-> code)

| # | Spec claim | Verified against | Result |
|---|-----------|------------------|--------|
| 1 | `listSchema` supports `from/to/search/interactionType/status/limit/cursor` | `packages/core/src/modules/customers/api/interactions/route.ts:43-60` | OK. Plus extras the spec doesn't use: `type` (comma-separated multi-type, lines 415-420), `excludeInteractionType`, `pinned`, `sortField`/`sortDir`, `entityId`, `dealId`. `limit` max 100 (default 25). |
| 2 | `from`/`to` filter on `coalesce(occurred_at, scheduled_at, created_at)` | route.ts:437-442 | OK. Exact SQL: `coalesce(occurred_at, scheduled_at, created_at) >= ${from}` / `<= ${to}` |
| 3 | Response includes `updatedAt`, `participants`, `location`, `allDay`, `durationMinutes`, `recurrenceRule`, `appearanceColor`, `ownerUserId` | route.ts:533-569 (`baseItems`) | OK. All present, plus `recurrenceEnd`, `appearanceIcon`, `authorName`, `dealTitle`, `customValues`, and a duplicate `duration` alias of `durationMinutes`. Note: response schema types `entityId` as nullable (route.ts:614) — UI must handle defensively. |
| 4 | POST requires `entityId` + `interactionType` | `data/validators.ts:418-438` (`interactionCreateBaseSchema`) | OK. `entityId: z.string().uuid()` (required), `interactionType: min(1)` (required). `status` defaults `'planned'`; `scheduledAt` derived from `date`+`time` when absent (validators.ts:473-477). `participants[].userId` is a **required uuid** — participants are staff users only. |
| 5 | Cursor pagination mechanics | route.ts:579-591 | OK. Response `{ items, nextCursor }`; `nextCursor` (base64 `{id, sortValue}`) present only when more rows; follow via `?cursor=`. Default sort `scheduledAt asc` with null-sentinels. Invalid cursor -> 400. Working in-repo precedent: `components/detail/MiniWeekCalendar.tsx:112-131` already does the exact `limit=100` + do/while `nextCursor` loop over a `from`/`to` window. |
| 6 | ACL features exist | `acl.ts:67-72` | OK. `customers.interactions.view` and `customers.interactions.manage` (manage `dependsOn` view). `setup.ts`: admin gets `customers.*`, **employee gets only `.view`** — default employees see the calendar but no create CTA. |
| 7 | POST/PUT run command bus (undo-integrated) | route.ts:84-148 | OK. `makeCrudRoute` actions -> `customers.interactions.create` / `.update` / `.delete` command ids. |
| 8 | Existing CrudForm-in-dialog precedent | `components/detail/ActivityDialog.tsx` (Dialog -> `ActivityForm` -> `CrudForm`) | OK — but see Correction C4: the schedule-rich composer is `ScheduleActivityDialog.tsx`, which is **not** CrudForm-based. |
| 9 | Optimistic-lock guard satisfied by CrudForm | `packages/core/src/__tests__/optimistic-lock-ui-coverage.test.ts` | OK. The guard marks a file COVERED when it contains the literal `<CrudForm` (or lock primitives, or an `optimistic-lock-exempt:` marker). A CrudForm-hosting dialog file passes with **no allowlist entry**. `optimistic-lock-editable-entities.test.ts` is N/A (no new entity; `CustomerInteraction` has `updated_at` and the API returns `updatedAt`). If reusing `ScheduleActivityDialog`, it is already covered (`buildOptimisticLockHeader` + `withScopedApiRequestHeaders`, lines 414-433). |
| 10 | UI primitives exist | `packages/ui/src/primitives/` + `packages/ui/AGENTS.md` | OK — ALL exist with exact paths: `Avatar`/`AvatarStack` (`@open-mercato/ui/primitives/avatar`), `SegmentedControl`/`SegmentedControlItem` (`.../segmented-control`), `SearchInput` (`.../search-input`), `Kbd`/`KbdShortcut` (`.../kbd`), `StatusBadge` (`.../status-badge`), `EmptyState` (`.../empty-state`; backend variant `.../backend/EmptyState`), `DatePicker`/`DateRangePicker`/`Calendar` (`.../date-picker`, `.../date-range-picker`, `.../calendar`), `Popover` (`.../popover`), `Dialog` (`.../dialog`), `Tabs` **with `variant: 'underline'`** (`.../tabs.tsx:31,45` — matches the mockup's underline tabs), `LoadingMessage`/`ErrorMessage` (`@open-mercato/ui/backend/detail`). Nothing missing. |
| 11 | date-fns available in core | `packages/core/package.json:235-236` | OK. `date-fns@4.4.0` + `date-fns-tz@^3.2.0`. `rrule` npm is **not** a dependency anywhere. |
| 12 | `@open-mercato/ui/backend/schedule` importable | `packages/ui/package.json:21-24` | OK — exported (src types + dist). But see Correction C3 — `expandRecurringItems` is unsuitable anyway. |
| 13 | jest module-local tests | `packages/core/jest.config.cjs:42` (`src/**/__tests__/**/*.test.(ts|tsx)`) | OK. Mirror `customers/lib/__tests__/interactionReadModel.test.ts`. `lib/calendar/__tests__/*.test.ts` will be picked up. |
| 14 | `__integration__` conventions | `customers/__integration__/TC-CRM-001.spec.ts:1-5` | OK. TC-CRM-001..020 live there; helpers: `login` from `@open-mercato/core/modules/core/__integration__/helpers/auth`, `apiRequest`/`getAuthToken` from `.../helpers/api`, `deleteEntityIfExists` from `.../helpers/crmFixtures`. Runner: `.ai/qa/tests/playwright.config.ts` (testDir = repo root, discovers module `__integration__` specs). |
| 15 | i18n locales | `customers/i18n/` | OK. `en/de/es/pl.json` all exist; key style is **flat dotted keys in one JSON object** (e.g. `"customers.people.form.status.placeholder"`); `customers.calendar.*` fits. |
| 16 | `yarn check:client-boundaries` | root `package.json:101-102` | OK — exists (`scripts/check-client-boundaries.mjs`, plus `:fail` variant). |
| 17 | Route collision | repo-wide find | OK. Nothing claims `/backend/calendar`. Route mapping precedent: `customers/backend/customer-tasks/page.{tsx,meta.ts}` -> `/backend/customer-tasks` (meta gated by `customers.interactions.view`). |
| 18 | Dictionary endpoint used by detail pages | `api/dictionaries/[kind]/`, `api/dictionaries/context.ts:47` | OK. `GET /api/customers/dictionaries/activity-types` (kebab slug -> stored kind `activity_type`). Components fetch it directly via `apiCall` (e.g. `DictionarySettings.tsx:156`, `ManageTagsDialog.tsx:560`). |
| 19 | Seeded activity types | `cli.ts:113-119` (`ACTIVITY_TYPE_DEFAULTS`) | OK. Exactly 5: `call` #2563eb, `email` #16a34a, `meeting` #f59e0b, `note` #a855f7, `task` #ef4444. **No `event` entry** — spec's seeding need is real. `ensureDictionaryEntry` (`commands/shared.ts:159`) is insert-if-absent keyed on normalized value (it also syncs color/icon on existing entries when provided — a new value is a pure insert). |
| 20 | Data-driven colors via inline style precedent | `dictionaries/components/dictionaryAppearance.tsx:443` (`renderDictionaryColor` -> `style={{ backgroundColor }}`) | OK. Inline-style data colors are the established pattern; a soft-tint derivation helper is new but consistent. |
| 21 | `fetchAssignableStaffMembers` for participants | `customers/components/detail/assignableStaff.ts:143` -> `/api/staff/team-members/assignable` (staff module route exists) | OK. Note the file documents graceful degradation when the staff module is disabled. |
| 22 | react-big-calendar rejection rationale | `packages/ui/src/backend/schedule/ScheduleCalendar.tsx:3-5`, `packages/ui/package.json:150` | OK. rbc + its CSS live in the shared `ScheduleCalendar`; staying away from it for a pixel-faithful DS build is sound. |
| 23 | `MiniWeekCalendar` / `ActivitiesDayStrip` exist | `components/detail/` | OK — both present. |

## Backward Compatibility

### Violations Found

| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|-------------|
| — | — | **None.** | — | — |

Checked all 13 categories against the spec's plan:
1. **Auto-discovery files** — only new files (`backend/calendar/page.{tsx,meta.ts}`, components, lib) and additive edits to `cli.ts`/`setup.ts`/i18n. Additive.
2. **Types** — no public type changes.
3. **Function signatures** — none changed. (Caveat: if the dialog decision lands on extending `ScheduleActivityDialog`, the new entity-picker props MUST be additive/optional — `entityId` is currently a required prop consumed by 3 detail pages.)
4. **Import paths** — none moved.
5. **Event IDs** — none added/renamed; reuses `customers.interaction.*` emissions.
6. **Widget spot IDs** — none.
7. **API routes** — none added/changed; the interactions route is consumed read-only + existing POST/PUT/DELETE.
8. **DB schema** — none; seed-only (insert-if-absent dictionary row).
9. **DI names** — none.
10. **ACL feature IDs** — none added; reuses existing two.
11. **Notification IDs** — none.
12. **AI agent/tool IDs** — none.
13. **CLI / generated contracts** — none; `yarn generate` regenerates registries additively.

### Missing BC Section
Spec includes "Migration & Compatibility" — adequate. One sentence should be added if option (a) of C1 is chosen (sidebar ordering change in `backendChrome.tsx` affects all tenants' sidebars, though it is not a contract surface).

## Corrections Needed (spec claim -> actual fact)

### C1 — `pageGroup: 'General'` placement (CRITICAL: decide before Phase 1)
- **Spec claims**: "sidebar group **General**, directly under Dashboard ... (`pageGroup: 'General'`, precedent: planner)".
- **Actual**: `pageGroup: 'General'` exists **nowhere** in the repo (full enumeration across core/enterprise/checkout/official-modules: Customers, Catalog, Sales, Employees, Module Configs, Messages, ...). The cited planner precedent uses `pageGroup: 'Module Configs'` with `pageContext: 'settings'` (`planner/backend/planner/availability-rulesets/page.meta.ts`) — a settings-section precedent, not a main-sidebar one. There is also **no Dashboard sidebar item** — the logo links to `/backend` (`AppShell.tsx:698-706`); sidebar groups come exclusively from route `pageGroup` metadata via `/api/auth/admin/nav`.
- **Consequence**: main-sidebar group ordering is fixed by `normalizeGroupWeights()` in `packages/core/src/modules/auth/lib/backendChrome.tsx:143-175` with a hardcoded `defaultGroupOrder` (`customers.nav.group` first, ... `customers.storage.nav.group` last). A new group key not in that list sorts **after all eight known groups** — i.e. a new "General" group lands near the bottom, not at the top.
- **Fix options (spec must pick one)**:
  - (a) Add the new group key (e.g. `customers.calendar.nav.group`) to `defaultGroupOrder` at position 0 — top placement achieved, but touches the shared `backendChrome.tsx`, contradicting the spec's "blast radius: the new route only" claim; that claim must be amended.
  - (b) Place the page in the existing **Customers** group (`pageGroup: 'Customers'`, `pageGroupKey: 'customers.nav.group'`, low `pageOrder` to sit first in the group) — zero shared-file impact, mockup deviation is presentational only.
  - (c) Keep a new 'General' group and accept trailing placement.
  - Recommendation: (b), documented as a mockup adaptation; or (a) with the blast-radius sentence corrected.

### C2 — Toolbar search: server `?search=` is a no-op on default tenants (HIGH)
- **Spec claims**: "search (server `search` within window, debounced)".
- **Actual**: interaction `title`/`body` are encrypted at rest (`customers/encryption.ts` declares `customers:customer_interaction`; route.ts:427-435 documents that the ILIKE matches ciphertext and returns no rows) and tenant encryption **defaults ON** (`packages/shared/src/lib/encryption/toggles.ts:3-10` — `TENANT_DATA_ENCRYPTION` undefined -> `true`). On a default deployment the search box would silently return an empty calendar.
- **Fix**: filter **client-side** over the already-loaded window (titles arrive decrypted in the list payload, route.ts:524-531) — the window is fully loaded for rendering anyway. Drop the server `search` usage or keep it only as a documented fallback for encryption-disabled tenants. Update TC-CAL-004's search assertion accordingly (client-side narrowing).

### C3 — Recurrence subset must match what the platform actually stores (HIGH)
- **Spec claims**: "reuse rrule approach from `packages/ui` schedule lib if importable, else minimal RRULE subset for FREQ=DAILY/WEEKLY ... unit tests pin supported subset (DAILY/WEEKLY + interval + until/count)".
- **Actual**: the only producer of `recurrence_rule` values in the product is `ScheduleActivityDialog.buildRecurrenceRule()` (`ScheduleActivityDialog.tsx:761-773`), which writes **`FREQ=WEEKLY;BYDAY=MO,WE,FR`** (multi-day) plus optional `;COUNT=n` or `;UNTIL=YYYYMMDDT235959Z`. `INTERVAL` is never written. The importable `expandRecurringItems` (`packages/ui/src/backend/schedule/recurrence.ts`) **ignores `BYDAY` entirely** (weekly = same weekday as the item's start, line 84), ignores `COUNT` for weekly, and reads `ScheduleItem.metadata.rule.rrule` — wrong data shape and wrong semantics for interactions. Reusing it would mis-render the platform's own recurring activities.
- **Fix**: write the local `lib/calendar/recurrence.ts` util (spec's fallback path) with the subset **`FREQ=WEEKLY` + `BYDAY` list + `COUNT`/`UNTIL`, and `FREQ=DAILY`**; drop `INTERVAL` from the pinned tests (or add it as a bonus); also respect the separate `recurrenceEnd` column (route returns it) as an expansion bound. Unsupported rules -> render base occurrence only (spec already says this).

### C4 — Dialog composer: name the real components and decide reuse vs. rebuild (MEDIUM)
- **Spec claims**: "Create/edit dialog (CrudForm against the existing interactions API...)" and "same person/company select pattern as detail pages".
- **Actual**: two composers exist today:
  - `ActivityDialog.tsx` + `ActivityForm.tsx` — CrudForm-in-Dialog (the precedent the spec implies), but **simple** (type/title/body/date/time; takes a static `entityOptions` array, no scheduling extras).
  - `ScheduleActivityDialog.tsx` — the scheduling composer whose field set **exactly matches the calendar mockup dialog** (title, type, date, start time, duration, all-day, location, participants via `fetchAssignableStaffMembers`, owner, notes, recurrence builder, reminder, visibility), with a debounced **server-side conflict check** against the existing `GET /api/customers/interactions/conflicts` route (querySchema: `date`, `startTime`, `duration`, `excludeId`, `userId`, `timezoneOffsetMinutes`) and correct optimistic-lock/`useGuardedMutation` wiring. It is **not** CrudForm-based and currently **requires `entityId` as a prop** (detail pages supply it).
  - The "person/company select pattern" for a global-context "Linked to" picker is `useDealAssociationLookups()` + `EntityMultiSelect` in `components/detail/DealForm.tsx:330,530` (searches `/api/customers/people|companies?search=&pageSize=20`, hydrates by `?ids=`); a single-select variant is needed for `entityId`.
- **Fix**: spec must state the decision explicitly. Recommended: **extend `ScheduleActivityDialog` with an optional entity picker** (new optional props, additive — existing 3 call sites unaffected) instead of building a parallel CrudForm dialog that would duplicate the recurrence builder, participants picker, conflict check, and lock wiring. If the CrudForm route is kept regardless, the spec should acknowledge the duplication and that the create-time conflict warning comes for free only with reuse. Either path passes the optimistic-lock guard (see Verified #9).

### C5 — Seed location wrong in File Manifest (MEDIUM)
- **Spec claims**: File Manifest row "`packages/core/src/modules/customers/lib/dictionaries.ts` + `setup.ts` | Modify | Additive `event` default activity type"; Design Decisions says "`seedCustomerDictionaries()` gains an `event` entry".
- **Actual**: `lib/dictionaries.ts` is a kinds/type re-export helper only (no seed data). `ACTIVITY_TYPE_DEFAULTS` and `seedCustomerDictionaries()` live in **`cli.ts`** (lines 113, 1101); `setup.ts` already calls `seedCustomerDictionaries` from `./cli` in `seedDefaults` — `setup.ts` likely needs **no change at all**. Manifest row should read `cli.ts` (modify `ACTIVITY_TYPE_DEFAULTS`). Side effects to note: the new value joins `STRESS_TEST_DEAL_ACTIVITY_TYPES` (cli.ts:1000, harmless) and **existing tenants only receive it when seeds re-run** — the spec's "fresh tenants" framing is honest but should name the re-run path. Color note: `meeting` already uses #f59e0b (amber); pick a distinct yellow (e.g. #eab308) for `event` to keep pills distinguishable.

### C6 — Minor factual notes (LOW)
- A **server-side conflict API already exists** (`api/interactions/conflicts/route.ts`, single-slot check). The spec's client-side pairwise window detection is complementary, not the only option; mention the existing route so reviewers don't flag "missing reuse".
- The list route supports **`type=` comma-separated multi-type filtering** — the filter popover / category tabs can push type narrowing to the server instead of pure client mapping (optional optimization; client mapping is still needed for counts-after-search).
- Response carries both `duration` and `durationMinutes` (aliases) — use `durationMinutes`.
- Response schema types `entityId` nullable — guard the edit dialog prefill.
- `participants[].userId` is a required uuid (staff users only); avatars from stored `name` work as planned.
- Employee role lacks `customers.interactions.manage` by default -> integration tests creating events must authenticate as admin (the existing helpers do).
- Effective-date semantics: spec's "grid = `occurredAt ?? scheduledAt`, agenda includes `createdAt` fallback" matches the API coalesce exactly.

## Spec Completeness

### Missing Sections
| Section | Impact | Recommendation |
|---------|--------|---------------|
| — | All required sections present (TLDR, Overview, Problem, Solution, Architecture, Data Models, API Contracts, UI/UX, i18n, Frontend Architecture Contract, Migration & Compatibility, Implementation Plan + File Manifest, Testing Strategy, Integration Test Coverage, Risks, Final Compliance Report, Implementation Status, Changelog). | — |

### Incomplete Sections
| Section | Gap | Recommendation |
|---------|-----|---------------|
| Proposed Solution / page.meta | Sidebar group decision is based on a false precedent (C1) | Rewrite per chosen option; include final `pageGroup`/`pageGroupKey`/`pageOrder` values |
| API Contracts -> search | Encrypted-tenant search behavior (C2) | Replace server search with client-side window filtering |
| Implementation Plan step 2 (recurrence) | Wrong subset (C3) | Pin `WEEKLY+BYDAY+COUNT/UNTIL` + `DAILY`; drop INTERVAL claim |
| UI/UX dialog + Phase 5 | Composer ambiguity (C4) | Name `ScheduleActivityDialog` vs `ActivityDialog`; record the reuse decision and picker component (`useDealAssociationLookups`-style single select) |
| File Manifest | Wrong seed file (C5) | `cli.ts` instead of `lib/dictionaries.ts`; `setup.ts` likely untouched |
| Final Compliance Report | Claims "Fully compliant — Approved" before these corrections | Re-verdict after spec updates |

## AGENTS.md Compliance

### Violations
| Rule | Location | Fix |
|------|----------|-----|
| "Blast radius: the new route only / no shared component is modified" vs. top sidebar placement | Risks / Operational + Proposed Solution | Only true under C1 option (b)/(c); amend if (a) chosen |
| `packages/ui/AGENTS.md`: "Use `CrudForm` for create/edit flows **unless the task explicitly needs a custom host**" | Phase 5 | Reusing `ScheduleActivityDialog` (custom host w/ `useGuardedMutation` + lock header) is the sanctioned alternative path; CrudForm rebuild also compliant — either way, document the choice (C4) |
| All other checked rules (apiCall-only, tenant scoping via existing route, i18n keys, dialog shortcuts, pageSize <= 100, DS tokens, lucide icons, meta icon convention, optimistic locking, integration tests self-contained) | — | Compliant as specced |

## Risk Assessment

### High Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| Search shipped server-side and returns nothing on default (encrypted) tenants | Core toolbar feature silently broken; QA on an encryption-off dev box would miss it | C2: client-side filtering; add an integration assertion on the default (encryption-on) ephemeral env |
| Recurring activities created via the existing Schedule dialog render on wrong days | Data correctness perception ("calendar shows my Mon/Wed/Fri series only on Monday") | C3: BYDAY-aware local expansion + unit tests using rules produced by `buildRecurrenceRule` itself |

### Medium Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| Sidebar group lands at bottom instead of top | UX mismatch vs. mockup expectation | C1 decision before Phase 1 |
| >500 items per month window (spec's own register) | Month view undercounts for extreme tenants | Already mitigated in spec (cap + notice); keep |
| Parallel dialog implementation drifts from `ScheduleActivityDialog` (duplicate recurrence/participants/conflict logic) | Two divergent interaction composers to maintain | C4: prefer reuse with additive props |

### Low Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| Staff module disabled -> `/api/staff/team-members/assignable` absent | Participants picker empty | `assignableStaff.ts` already degrades gracefully; reuse it |
| Dictionary fetch failure | Neutral colors | Already in spec (fallback chain) |
| `entityId` null in legacy rows | Edit dialog prefill crash | Defensive null handling (C6) |
| Multi-day all-day events | Model has no end-date beyond `durationMinutes`; all-day renders single-day | Acceptable; matches model |

## Gap Analysis

### Critical Gaps (Block Implementation)
- **C1 sidebar placement decision** — pick (a)/(b)/(c) and update spec text + File Manifest (option (a) adds `backendChrome.tsx` to the manifest).

### Important Gaps (Should Address)
- **C2 search semantics** (client-side over window) + TC-CAL-004 wording.
- **C3 recurrence subset** (WEEKLY+BYDAY+COUNT/UNTIL, DAILY; honor `recurrenceEnd`).
- **C4 dialog reuse decision** + named picker pattern (`useDealAssociationLookups` single-select adaptation) and, if reusing, additive prop contract for `ScheduleActivityDialog`.
- **C5 File Manifest seed row** -> `cli.ts`.

### Nice-to-Have Gaps
- Mention existing `interactions/conflicts` route as create-time conflict source (free if reusing the schedule dialog).
- Use `type=` multi-type server filtering for the filter popover.
- Note re-seed path for existing tenants to receive the `event` dictionary entry.
- Distinct yellow for `event` (meeting already owns #f59e0b).

## Remediation Plan

### Before Implementation (Must Do)
1. **Resolve C1**: pick sidebar placement; recommended (b) `pageGroup: 'Customers'` first-in-group, or (a) with manifest + blast-radius amendments.
2. **Amend spec text** for C2 (client-side search), C3 (recurrence subset incl. BYDAY; INTERVAL removed), C5 (seed in `cli.ts`).
3. **Record the C4 decision** (recommended: extend `ScheduleActivityDialog` with optional entity-picker props; keep `ActivityDialog` untouched).

### During Implementation (Add to Spec)
1. Update TC-CAL-004 to assert client-side search narrowing; keep TC-CAL-001's API assertions unchanged (verified accurate).
2. Unit-test recurrence expansion against rules generated by `buildRecurrenceRule` (round-trip with the real producer).
3. Note `duration` vs `durationMinutes` alias and nullable `entityId` handling in the data-hook section.

### Post-Implementation (Follow Up)
1. Consider an upgrade action / documented seed re-run so existing tenants get the `event` activity type.
2. Future server aggregation endpoint for month counts (already in spec's residual risk).

## Recommendation

**READY WITH CORRECTIONS** — the no-new-entity/no-new-API premise is fully verified and all required primitives, helpers, test scaffolding, and guard mechanics exist exactly where needed. Apply corrections C1-C5 to the spec text (one decision, four factual fixes) before starting Phase 1; none requires architectural rework.
