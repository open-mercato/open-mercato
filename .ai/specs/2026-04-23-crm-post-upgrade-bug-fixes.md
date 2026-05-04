# CRM Post-Upgrade Bug Fixes

**Status:** Implemented — all six phases complete.
**Scope:** OSS — `@open-mercato/core` / `customers` + `audit_logs` modules + cross-cutting `ui` primitives
**Date:** 2026-04-23
**Owner:** @haxiorz
**Reporter:** @pkarw
**Source issues:** [#1657](https://github.com/open-mercato/open-mercato/issues/1657), [#1658](https://github.com/open-mercato/open-mercato/issues/1658), [#1659](https://github.com/open-mercato/open-mercato/issues/1659), [#1660](https://github.com/open-mercato/open-mercato/issues/1660), [#1661](https://github.com/open-mercato/open-mercato/issues/1661), [#1662](https://github.com/open-mercato/open-mercato/issues/1662), [#1663](https://github.com/open-mercato/open-mercato/issues/1663), [#1664](https://github.com/open-mercato/open-mercato/issues/1664), [#1665](https://github.com/open-mercato/open-mercato/issues/1665)
**Design reference:** Figma file "Karta Firmy — playful lime style" (canvas `22:2`). Key frames: `105:4` Person v2 detail, `83:2` Company detail, `521:2` Company → Deals, `545:2` Deals list, `166:2` Schedule activity dialog, `46:9361` Assign Role modal.

---

## TLDR

After the CRM detail-pages upgrade landed (SPEC‑046, SPEC‑046b, `2026-04-06-crm-detail-pages-ux-enhancements`, `2026-04-19-crm-linking-modals-and-mobile-variants`), nine user‑reported bugs surfaced across CRM v2 detail pages, the deals list, the activity/interaction scheduling flow, CRM roles, note → changelog attribution, and collapsible section state persistence. This spec bundles them into one cohesive fix pass: restore parity with the rest of the backoffice (header utility icons + translations), fix deal list filters, make the `RoleAssignmentRow` human‑friendly, expose the role dictionary editor, overhaul the inline "Log activity" UX, repair undo for scheduled activities, make deal notes appear in the deal changelog, and make section/zone collapse state truly persist across refreshes.

Scope is explicitly **bug‑fix** — no new CRM features. Every phase ships with integration tests that would have caught the regression.

---

## Resolved Decisions

> **Status: Open Questions gate closed on 2026-04-23.** Decisions below drive the detailed phase plan.

| # | Decision | Source |
|---|---------|--------|
| Q1 | **(a, review-corrected)** Keep bespoke card header; add **Send message** and **Object-history** icon actions + missing i18n keys. | Issue #1665 explicitly reports both missing utility actions; implementation keeps the bespoke Figma header shape |
| Q2 | **(d, implementation-corrected)** Server-side related-resource matching in `/api/audit_logs/audit-logs/actions` when `includeRelated=true`. Raw `snapshotAfter.dealId` filtering is blocked by encrypted snapshots, so use additive generic related-resource columns instead. | Runtime encryption constraint, BC-safe (additive query + columns + index) |
| Q3 | **Root cause identified during pre-impl research**: `POST /api/customers/interactions` does **not** emit `x-om-operation` response header with `withOperationMetadata()`, unlike every other customers API. The undoToken never reaches the browser's operation store, so the global undo resolver returns `null`. **Fix**: wrap the interactions API success responses with `withOperationMetadata()`. UI-side `flash()` changes are **not** needed — the existing header-based pattern already works for other commands. | Pre-impl research, [entity-roles-factory.ts:392-396](packages/core/src/modules/customers/api/entity-roles-factory.ts) reference pattern |
| Q4 | **Scope (a) + hook-level fix**: `pageType` keys are already stable & correctly scoped across Person/Company/Deal detail pages (`person-v2`, `company-v2`, `deal-detail-v3`). The perceived "always expanded after refresh" is the `useEffect`-driven hydration flash — render paints `defaultValue=false` for one tick before localStorage hydrates. Fix: rewrite `usePersistedBooleanFlag` to read localStorage during a lazy `useState` initializer on the client, using `useSyncExternalStore` to avoid hydration mismatch warnings. Scope is Zone 1 + CrudForm collapsible groups (already persisted). Zone 2 section-level persistence is out of scope (spec option c is a **scope expansion**, not a bug fix). | Pre-impl research |
| Q5 | **(a)** Server-side derive `userName` from email local-part when `auth_users.name` is `NULL`. Field stays typed `string \| null` per BC #2. | Figma `105:195` renders name-only (no email fallback). Option (c) remains blocked by BC contract. |
| Q6(i) | **(α)** Rename section to **"My roles with {name}"** (personal framing — "My roles with Sarah") on person detail; **"Roles at {company}"** on company detail. Keeps the "roles" vocabulary; removes confusion by making the subject explicit. | Figma `105:195` title: "My roles with Sarah" / subtitle: "Multi-role assignment for person" |
| Q6(ii) | **(β)** Add "Manage role types" link **inside `AssignRoleDialog`** near the ROLE TYPE card. Gated by `customers.settings.manage` via wildcard-aware `hasFeature` matcher. Target path: `/backend/config/dictionaries/<role-dictionary-id>` (confirmed in Phase 5 preview). | Figma `46:9361` shows `dictionary` chip + "Change" button inside the modal |
| Q7 | **(a)(i) modified**: Upgrade `InlineActivityComposer` description to a ≥3-row autosize textarea. **Keep `MiniWeekCalendar` expanded by default** (preserves Figma `105:227` designer intent — the week preview is informational), but add a **"Hide week preview"** toggle persisted via `usePersistedBooleanFlag` under key `om:inline-composer:week-preview:{entityKind}`. | Figma `105:227` + reporter feedback reconciled |
| Q8 | **(a) + (c)**: (a) Keep People/Companies filters as `type: 'tags'` because `TagsInput` is already value-keyed; fix the actual bug by removing ID ↔ label round-tripping and using `formatValue` for chip labels. (c) Sync `advancedFilterState` to the URL with the existing `filter[...]` encoding so browser and API filtering share one lossless shape. (b) Dictionary `filterKey` audit is a follow-up — accept both `pipeline_stage` and `pipelineStage` server-side during a bridge release. | Figma `545:2`, `521:2` + implementation scope correction |

### Figma Evidence (design anchors)

Each design-related decision is anchored to a Figma frame in the canvas "Karta Firmy — playful lime style" (`22:2`):

- **Q1 header utility row** → [Frame 105:57](nodeId:105:57) — Person detail top-right action cluster
- **Q5/Q6 roles section** → [Frame 105:195](nodeId:105:195) — "My roles with Sarah" card (title, subtitle, assignee rows)
- **Q6(ii) dictionary link placement** → [Frame 46:9361](nodeId:46:9361) — Assign Role modal with `dictionary` chip + Change button
- **Q7 inline composer layout** → [Frame 105:227](nodeId:105:227) — Log activity card (title, tabs, textarea, date chip, mini week calendar)
- **Q8 filter UI** → [Frame 545:2](nodeId:545:2) (Deals list) + [Frame 521:2](nodeId:521:2) (Company deals tab) — dropdown selects with counts

---

## Problem Statement

The CRM detail pages have been through three consecutive ambitious upgrades (`SPEC-046`, `SPEC-046b`, `2026-04-06-crm-detail-pages-ux-enhancements`, `2026-04-19-crm-linking-modals-and-mobile-variants`) in under three months. The upgrades introduced:

1. A new zone‑based layout (Zone 1 = CrudForm, Zone 2 = tabs) with its own collapse machinery separate from the shared `FormHeader`.
2. A bespoke header per entity (person, company, deal) that replaced `FormHeader` for CRM but not elsewhere.
3. A new unified interaction model (Activities/Tasks/Notes merged into `CustomerInteraction`) with dedicated create/schedule/log flows.
4. Role‑assignment semantics ("who on our side owns this relationship") distinct from platform RBAC.
5. A new changelog projection backed by `audit_logs` with parent‑resource filtering.

Each upgrade was correct in isolation, but together they broke expectations about:

- **Visual parity** with the rest of the backoffice — users don't understand why the CRM looks "different" ([#1665](https://github.com/open-mercato/open-mercato/issues/1665)).
- **Audit attribution** — a note on a deal is filed under the related person/company because the log write chooses one parent ([#1659](https://github.com/open-mercato/open-mercato/issues/1659)).
- **Command symmetry** — undo works for past activities but not future ones because of a subtle mismatch between toast wiring and log commit ordering ([#1661](https://github.com/open-mercato/open-mercato/issues/1661)).
- **UI state durability** — collapsible sections "always start expanded" after refresh despite the localStorage hook being in place ([#1657](https://github.com/open-mercato/open-mercato/issues/1657), [#1658](https://github.com/open-mercato/open-mercato/issues/1658)).
- **List ergonomics** — deal filters silently drop rows; role rows show raw emails where names were expected ([#1664](https://github.com/open-mercato/open-mercato/issues/1664), [#1663](https://github.com/open-mercato/open-mercato/issues/1663)).
- **Feature discoverability** — the role dictionary editor is buried in settings and the inline "Log activity" form privileges a decorative calendar over the note itself ([#1662](https://github.com/open-mercato/open-mercato/issues/1662), [#1660](https://github.com/open-mercato/open-mercato/issues/1660)).

None of these are showstoppers individually, but together they make the upgraded CRM feel inconsistent and brittle — exactly the opposite of the "production‑grade" promise made in the module's AGENTS.md ("This is the reference CRUD module").

---

## Proposed Solution

Six sequenced phases, each independently releasable and testable, each ending with a green CI gate (unit + integration tests per [.ai/qa/AGENTS.md](.ai/qa/AGENTS.md)):

1. **Phase 1 — Header parity ([#1665](https://github.com/open-mercato/open-mercato/issues/1665))**: Add Send-message and Object-history icons + i18n to bespoke Person/Company/Deal headers.
2. **Phase 2 — Audit attribution ([#1659](https://github.com/open-mercato/open-mercato/issues/1659))**: Server-side generic related-resource filter in `/api/audit_logs/audit-logs/actions` with additive indexed columns, populated by deal-linked note commands.
3. **Phase 3 — Undo parity for scheduled interactions ([#1661](https://github.com/open-mercato/open-mercato/issues/1661))**: Wrap `/api/customers/interactions` success responses with `withOperationMetadata()` so the undo token reaches the browser's operation store.
4. **Phase 4 — Zone 1 persistence hydration fix ([#1657](https://github.com/open-mercato/open-mercato/issues/1657), [#1658](https://github.com/open-mercato/open-mercato/issues/1658))**: Rewrite `usePersistedBooleanFlag` to read localStorage during initial render via `useSyncExternalStore` — eliminates the perceptible flash.
5. **Phase 5 — Roles ergonomics ([#1662](https://github.com/open-mercato/open-mercato/issues/1662), [#1663](https://github.com/open-mercato/open-mercato/issues/1663))**: (a) Section rename to "My roles with {name}" / "Roles at {company}"; (b) API derives `userName` from email local-part when `auth_users.name` is null; (c) "Manage role types" deep link inside `AssignRoleDialog`.
6. **Phase 6 — Filters + composer polish ([#1664](https://github.com/open-mercato/open-mercato/issues/1664), [#1660](https://github.com/open-mercato/open-mercato/issues/1660))**: Deal-list People/Companies filter → value-keyed select; `advancedFilterState` URL sync; `InlineActivityComposer` 3-row textarea + optional "Hide week preview" toggle.

---

## Non‑Goals

- No migration to an entirely new CRM schema.
- No rewrite of `ChangelogTab`, `AssignRoleDialog`, `ScheduleActivityDialog`, or `DataTable` — only targeted fixes.
- No change to `action_logs` / `customer_interactions` / `customer_comments` primary keys or existing columns (additive only per the BC contract).
- No expansion of the role dictionary taxonomy; only surfacing of the existing editor.
- No change to the Zone 1 / Zone 2 split introduced by SPEC‑046.

---

## Dependencies & References

- **Reference module:** [packages/core/src/modules/customers/AGENTS.md](packages/core/src/modules/customers/AGENTS.md)
- **Shared UI contracts:** [packages/ui/AGENTS.md](packages/ui/AGENTS.md), [packages/ui/src/backend/forms/FormHeader.tsx](packages/ui/src/backend/forms/FormHeader.tsx), [packages/ui/src/backend/crud/CollapsibleZoneLayout.tsx](packages/ui/src/backend/crud/CollapsibleZoneLayout.tsx)
- **Predecessor specs:**
  - [SPEC-046 Customer Detail Pages v2](packages/core/.ai/specs/implemented/SPEC-046-2026-02-25-customer-detail-pages-v2.md)
  - [SPEC-046b Customers Interactions Unification](packages/core/.ai/specs/implemented/SPEC-046b-2026-02-27-customers-interactions-unification.md)
  - [CRM Detail Pages UX Enhancements](packages/core/.ai/specs/2026-04-06-crm-detail-pages-ux-enhancements.md)
  - [CRM Linking Modals & Mobile Variants](packages/core/.ai/specs/2026-04-19-crm-linking-modals-and-mobile-variants.md)
  - [SPEC-016 Form Headers & Footers](.ai/specs/implemented/SPEC-016-2026-02-03-form-headers-footers.md)
  - [SPEC-039 Date Pickers](.ai/specs/implemented/SPEC-039-2026-02-22-date-pickers.md)
  - [SPEC-021 Compound Commands / Graph Save](.ai/specs/SPEC-021-2026-02-07-compound-commands-graph-save.md) (undo semantics)
- **Backward compatibility contract:** [BACKWARD_COMPATIBILITY.md](BACKWARD_COMPATIBILITY.md) — surfaces affected: #2 (types), #7 (API), #8 (DB — additive‑only), potentially #5 (events) and #6 (widget spots) depending on Q1/Q4.
- **Pre-implementation analysis:** [.ai/specs/analysis/ANALYSIS-2026-04-23-crm-post-upgrade-bug-fixes.md](.ai/specs/analysis/ANALYSIS-2026-04-23-crm-post-upgrade-bug-fixes.md) — claim verification, per-option BC verdict, risk assessment, remediation plan.

---

## Implementation Phases

### Phase 1 — Header parity (Send-message + object-history icons) — [#1665](https://github.com/open-mercato/open-mercato/issues/1665)

**Goal:** Restore visual/functional parity between CRM detail headers and the rest of the backoffice by exposing both Send message and Object history (version log) actions that shared detail headers can expose through utility actions. Keep the bespoke CRM identity block untouched per Figma `105:4` / `83:2` / `521:2`.

**Scope:**
- [PersonDetailHeader.tsx](packages/core/src/modules/customers/components/detail/PersonDetailHeader.tsx)
- [CompanyDetailHeader.tsx](packages/core/src/modules/customers/components/detail/CompanyDetailHeader.tsx)
- [DealDetailHeader.tsx](packages/core/src/modules/customers/components/detail/DealDetailHeader.tsx)

**Out of scope:** Migrating to shared `FormHeader`. Mobile variants beyond what already renders.

**Steps:**

1. **Audit existing icon-button row in each header.** Confirm where the current `Save` button lives and what sibling slots exist (•••, chip, etc.). Target utility row per Figma `105:57`: `[Send icon-button 32×32] [History icon-button 32×32] [••• 32×32] [Save button]` with `gap-[8px]`.
2. **Introduce a shared `ObjectHistoryButton` wrapper** (colocated in the customers module, since the three headers are the only consumers) that:
   - Wraps the existing `VersionHistoryAction` from `@open-mercato/ui/backend/version-history` with the outline icon-button visual: `size-[32px] rounded-[6px] border border-[#e4e6ea] bg-white` (dark mode equivalent).
   - Receives `{ resourceKind, resourceId }` as props.
   - Uses `IconButton` primitive from `@open-mercato/ui/primitives` (per lesson "MUST use Button and IconButton primitives").
   - Icon: `History` from lucide-react, `size-[16px]`.
   - `aria-label={t('customers.header.history', 'View change history')}`.
3. **Insert send-message and history triggers into each detail header's action cluster** immediately to the left of the destructive/save actions:
   - Person: next to `More menu` at [PersonDetailHeader.tsx:???] — exact insertion point found in step 1.
   - Company: same pattern at [CompanyDetailHeader.tsx:???].
   - Deal: same pattern at [DealDetailHeader.tsx:???] using `resourceKind='customers.deal'`.
4. **Add i18n keys** to `packages/core/src/modules/customers/locales/{en,pl,...}.json` under `customers.header.*`:
   - `customers.header.history` → "View change history" / "Zobacz historię zmian"
   - `customers.header.moreMenu` → "More actions" / "Więcej akcji" (aria-label for `•••` if missing)
   - `customers.header.save` → "Save" / "Zapisz" (if not already keyed)
5. **Verify Send-object-message is reachable.** Use the existing `SendObjectMessageDialog` trigger in each header with the correct `{ entityModule: 'customers', entityType, entityId }` object context and the same outline 32px icon-button visual as history.

**API / DB / UI changes:**
- **API:** None.
- **DB:** None.
- **UI:** 3 files modified, 1 new helper component, locale keys added.

**Tests:**

*Unit:*
- `packages/core/src/modules/customers/components/detail/__tests__/ObjectHistoryButton.test.tsx` — renders `VersionHistoryAction` with the correct `resourceKind`/`resourceId`, icon-button visual, `aria-label`. Asserts Lucide `History` icon at `size-[16px]`.

*Integration (Playwright, per `.ai/qa/AGENTS.md`):*
- `packages/core/src/modules/customers/__integration__/TC-CRM-HEADER-001-history-icon-person.spec.ts` — Person detail page → click history icon → `VersionHistoryPanel` opens with entries scoped to `customers.person`.
- Same for `TC-CRM-HEADER-002-history-icon-company.spec.ts` and `TC-CRM-HEADER-003-history-icon-deal.spec.ts`.
- Uses `waitForLoadState('domcontentloaded')` + explicit visibility assertion (per lesson on SSE-heavy pages).

**Rollback:** Revert the three header files and delete the helper. i18n keys are additive (no removal needed).

**BC notes:** All changes are additive. No contract surface touched. No deprecation required.

### Phase 2 — Deal note → changelog attribution — [#1659](https://github.com/open-mercato/open-mercato/issues/1659)

**Goal:** Make deal-linked notes appear in the deal's changelog without altering the existing comment write path.

**Approach (final, after implementation encryption pivot):** A raw `snapshot_after->>'dealId'` jsonb filter can't work because `snapshot_after` is encrypted at rest. Instead, introduce generic **denormalized plaintext related-resource columns** `action_logs.related_resource_kind` and `action_logs.related_resource_id` populated by command `buildLog` hooks when a command's subject/parent also relates to another resource. The audit-logs API adds a third OR branch to the `includeRelated` clause matching those related-resource columns. Customer comment commands populate `customers.deal` through that generic surface. A composite btree index `(tenant_id, related_resource_kind, related_resource_id, created_at)` keeps it fast.

**Steps (implemented 2026-04-23):**

1. **Extend `CommandLogMetadata`** — add optional `relatedResourceKind?: string | null` and `relatedResourceId?: string | null` (additive per BC #2) in [`packages/shared/src/lib/commands/types.ts`](packages/shared/src/lib/commands/types.ts).
2. **Propagate through command-bus** — thread the new field through `mergeMetadata` and `persistLog` in [`packages/shared/src/lib/commands/command-bus.ts`](packages/shared/src/lib/commands/command-bus.ts) so it reaches `actionLogService.log(payload)`.
3. **Extend `actionLogCreateSchema`** — add optional `relatedResourceKind` and `relatedResourceId` in [`packages/core/src/modules/audit_logs/data/validators.ts`](packages/core/src/modules/audit_logs/data/validators.ts).
4. **Add entity columns + index** — `relatedResourceKind: string | null` and `relatedResourceId: string | null` on [`ActionLog`](packages/core/src/modules/audit_logs/data/entities.ts) with composite index `action_logs_related_resource_idx (tenantId, relatedResourceKind, relatedResourceId, createdAt)`.
5. **Persist new columns** in `ActionLogService.createLogEntity` ([`services/actionLogService.ts`](packages/core/src/modules/audit_logs/services/actionLogService.ts)).
6. **Extend `buildListQuery`** — when `includeRelated=true`, push a third branch matching `related_resource_kind = resourceKind` and `related_resource_id = resourceId` into the `eb.or([...])` clause.
7. **Populate from comment commands** — update create/update/delete `buildLog` hooks in [`commands/comments.ts`](packages/core/src/modules/customers/commands/comments.ts) to emit `relatedResourceKind: 'customers.deal'` and `relatedResourceId: snapshot.dealId` when a note is linked to a deal.
8. **Generate migration** `Migration20260423202109.ts` — additive: `alter table action_logs add related_resource_kind text null, add related_resource_id text null` + create the composite index.

**Tests (all passing):**
- Unit: 3 new cases in [`actionLogService.test.ts`](packages/core/src/modules/audit_logs/services/__tests__/actionLogService.test.ts) that exercise the `buildListQuery` OR group (3 branches for any resource with `includeRelated=true`, no OR group when `includeRelated=false`).
- Integration (Playwright): [`TC-CRM-042`](packages/core/src/modules/customers/__integration__/TC-CRM-042.spec.ts) — creates person + deal + comment with `dealId`, asserts deal changelog returns the comment, asserts an unrelated deal does not leak the comment.
- Live preview verified via curl: note with `dealId` appears under `/api/audit_logs/audit-logs/actions?resourceKind=customers.deal&...&includeRelated=true`.

**BC verdict:** Fully additive. New optional fields on `CommandLogMetadata` (BC #2), new optional fields on `actionLogCreateSchema` (BC #2), new columns on `action_logs` with NULL defaults (BC #8), new index (BC #8), new additive filter branch in an existing API (BC #7). No existing surface renamed/removed/narrowed. No deprecation protocol needed.

**Backfill strategy for historical logs:** Existing `action_logs` rows have `related_resource_id = NULL`, so notes created before this change will not appear in deal changelogs until re-logged. A one-off backfill subscriber could be added later — not in scope for this phase per the minimal-fix discipline. Recorded as follow-up.

### Phase 3 — Undo parity for scheduled interactions — [#1661](https://github.com/open-mercato/open-mercato/issues/1661)

**Goal:** Ensure every `/api/customers/interactions` write path emits the `x-om-operation` response header so the browser operation store registers the undo token and the global "Undo last action" banner works consistently for scheduled-activity flows.

**Scope pivot during implementation:** The original Q3 diagnosis claimed the root `POST /api/customers/interactions` route was missing the header. **Verified during implementation that's not true** — `makeCrudRoute` auto-wires `attachOperationHeader` for all POST/PUT/DELETE paths. A live curl test confirmed both past and scheduled `POST /api/customers/interactions` already emit `x-om-operation`, and a single-step undo succeeds end-to-end.

The **real gap** is in the two sub-routes that hand-roll custom handlers and bypass the factory's auto-wiring:

- [`/api/customers/interactions/complete`](packages/core/src/modules/customers/api/interactions/complete/route.ts) — `await commandBus.execute(...)` discarded the returned `logEntry`; response was `NextResponse.json({ ok: true })` with no `x-om-operation` header. Completing a scheduled activity produced a real audit_log row with an undo token, but the browser never learned about it, so the "Undo last action" chip couldn't target it.
- [`/api/customers/interactions/cancel`](packages/core/src/modules/customers/api/interactions/cancel/route.ts) — same gap.

**Steps (implemented 2026-04-23):**

1. **Extracted a shared `withOperationMetadata` helper** at [`packages/core/src/modules/customers/lib/operationMetadata.ts`](packages/core/src/modules/customers/lib/operationMetadata.ts). Mirrors the pattern that was previously duplicated locally in `entity-roles-factory.ts`; accepts a command-bus `logEntry` + a `{ resourceKind, resourceId }` fallback pair.
2. **Wired the helper into [`interactions/complete/route.ts`](packages/core/src/modules/customers/api/interactions/complete/route.ts)** — capture `{ logEntry }` from `commandBus.execute(...)` and pass it through.
3. **Wired into [`interactions/cancel/route.ts`](packages/core/src/modules/customers/api/interactions/cancel/route.ts)** — same pattern.
4. **Deduped** [`entity-roles-factory.ts`](packages/core/src/modules/customers/api/entity-roles-factory.ts) to import the shared helper (removed local copy). Three existing call sites (POST/PUT/DELETE on entity roles) continue to work unchanged.

**Tests (all passing):**
- Unit: 4 cases in [`operationMetadata.test.ts`](packages/core/src/modules/customers/lib/__tests__/operationMetadata.test.ts) covering happy path, fallback resource, missing undoToken, and null-log no-op.
- Integration (Playwright): [`TC-CRM-043`](packages/core/src/modules/customers/__integration__/TC-CRM-043.spec.ts) — creates a scheduled interaction, calls complete + cancel sub-routes, asserts each emits `x-om-operation`, and feeds each returned undoToken through `/api/audit_logs/audit-logs/actions/undo` — all three must return `ok: true`.
- Manual end-to-end: curl-tested the complete→undo flow against the dev server (HTTP 200, undo applied, log id returned).

**BC verdict:** Fully additive. New helper is internal to the customers module (not a public BC surface). Adding a response header is additive (BC #7). No field removed, no contract narrowed.

**Scope note:** The `ScheduleActivityDialog` and `InlineActivityComposer` flash messages still don't render an in-toast Undo button — they rely on the global `LastOperationBanner`. That's by design (the banner is the canonical undo surface). No change needed.

### Phase 4 — Zone 1 persistence hydration fix — [#1657](https://github.com/open-mercato/open-mercato/issues/1657), [#1658](https://github.com/open-mercato/open-mercato/issues/1658)

**Goal:** Eliminate the "renders expanded for one tick, then collapses" flash on refresh.

**Approach:** Rewrite `usePersistedBooleanFlag` with `useSyncExternalStore` so the client's first render synchronously reflects the stored value. On the server, `getServerSnapshot` returns `defaultValue` (localStorage is unavailable); React's `useSyncExternalStore` bridges the SSR/client snapshot divergence without emitting a hydration-mismatch warning.

**Steps (implemented 2026-04-23):**

1. **Replaced `useState + useEffect` with `useSyncExternalStore`** in [`packages/ui/src/backend/crud/usePersistedBooleanFlag.ts`](packages/ui/src/backend/crud/usePersistedBooleanFlag.ts). The `getSnapshot` function reads localStorage synchronously and returns `defaultValue` when the key is absent or the stored token isn't `'0'`/`'1'`. The `getServerSnapshot` returns `defaultValue` so SSR trees keep rendering consistently.
2. **Added a local `EventTarget` broadcaster** so two instances of the hook subscribed to the same `storageKey` inside the same tab see each other's writes immediately (the browser's `storage` event only fires in OTHER tabs). This was not a goal but drops out of the `useSyncExternalStore` shape for free and makes the behavior match user expectations.
3. **Behavior change (intentional):** the old hook wrote the `defaultValue` to localStorage on mount as an incidental side effect of its mounted-ref guard. The rewrite no longer writes until the user actually toggles or calls `setValue`. Fewer incidental writes, no visible UX impact, and a cleaner "I never touched that panel" contract for third-party code watching storage events. Test updated to assert this new behavior explicitly.

**Tests (all passing):**
- Unit: 9 cases in [`usePersistedBooleanFlag.test.ts`](packages/ui/src/backend/crud/__tests__/usePersistedBooleanFlag.test.ts):
  - Default value when empty (existing).
  - Hydrates `'1'` → true, `'0'` → false (existing).
  - `toggle`/`setValue` persist to localStorage (existing).
  - **New** — functional `setValue(prev => !prev)` form.
  - **New** — `defaultValue` is NOT written on mount (Phase 4 regression guard flipping the old "writes initial value on mount" test).
  - **New — critical flicker assertion** — first render after `localStorage.setItem('1')` already reports `value === true`. Previously the hook returned `defaultValue` on first render and required a `useEffect` tick to sync. This test reproduces the old bug and locks in the fix.
  - **New** — two hook instances against the same key stay in sync inside one tab via the local broadcaster.
- Regression sweep: 69 `ui/crud` tests + 84 `customers/components/detail` tests all pass unchanged.
- Integration (Playwright): [`TC-CRM-044`](packages/core/src/modules/customers/__integration__/TC-CRM-044.spec.ts) — seeds `om:zone1-collapsed:person-v2 = "1"` → refresh → asserts the "Expand form panel" aria-label is visible (zone is already collapsed on first paint), THEN seeds `"0"` → refresh → asserts "Collapse form panel" (zone is expanded).
- Live preview verified: round-tripped `"0"` ↔ `"1"` with refreshes against the dev server; button label flipped correctly on each reload and the screenshot proves the zone contents (form fields vs. icon rail) render in the right mode from the first observable paint.

**BC verdict:** Fully additive / behaviour-preserving at the signature level.

| Surface | Change | Classification |
|--|--|--|
| BC #3 `usePersistedBooleanFlag(storageKey, defaultValue)` | Signature unchanged; internal implementation swap | No-op at the contract boundary |
| Return shape `{ value, toggle, setValue }` | Unchanged | No-op |
| localStorage key schema | Unchanged | No-op |
| Write-on-mount side effect | Removed (was incidental, test acknowledged it as "observed behavior" rather than intended contract) | Behaviour improvement; no consumer depends on it |

**Scope note:** Zone 2 tab sections (`ActivitiesSection`, `PlannedActivitiesSection`, `DealsSection`, `TasksSection`, `ChangelogFilters`, `CompanyPeopleSection`, `RolesSection`) do not currently use `usePersistedBooleanFlag` and therefore neither flicker nor persist their collapse state. Expanding them to adopt the hook is spec option Q4(c) and remains **out of scope** for Phase 4 per the resolved-decision matrix — this phase strictly fixes the Zone 1 hydration flicker.

### Phase 5 — Roles ergonomics — [#1662](https://github.com/open-mercato/open-mercato/issues/1662), [#1663](https://github.com/open-mercato/open-mercato/issues/1663)

**Goal:** Three related fixes that together make the role-assignment section less confusing and align with the Figma design:
- **Q5(a)**: server-side derive `userName` from email local-part when `auth_users.name` is null (`userName` stays `string | null` per BC #2).
- **Q6(i)**: rename the Figma `105:195` section from the generic "Roles" to "My roles with {name}" (person) / "Roles at {name}" (company) so the subject is explicit and users stop confusing CRM role-types with platform RBAC roles.
- **Q6(ii)**: expose a "Manage role types" deep link inside `AssignRoleDialog` for users with `customers.settings.manage`, gated via the shared wildcard-aware `hasFeature` matcher.

**Steps (implemented 2026-04-23):**

1. **New helper** [`packages/core/src/modules/customers/lib/displayName.ts`](packages/core/src/modules/customers/lib/displayName.ts) — `deriveDisplayNameFromEmail(email)` splits the local-part on `. _ - +`, capitalises each segment, preserves existing internal casing, returns `null` for empty or separator-only input.
2. **Q5(a) wired into [`entity-roles-factory.ts`](packages/core/src/modules/customers/api/entity-roles-factory.ts)** — `userMap.name = user.name ?? deriveDisplayNameFromEmail(user.email) ?? null`. Response `userName` field stays `string | null` per BC #2.
3. **Q6(i) section rename** in [`RolesSection.tsx`](packages/core/src/modules/customers/components/detail/RolesSection.tsx):
   - Person: `My roles with {name}` (falls back to "this person" when `entityName` is absent).
   - Company: `Roles at {name}` (falls back to "this company").
4. **Thread `entityName` through [`formConfig.tsx`](packages/core/src/modules/customers/components/formConfig.tsx)** — updated the two legacy call sites (`createCompanyEditGroups` + `createPersonEditGroups`) that were not passing the name, so the new title renders on every detail page variant (Person v2 already passed it).
5. **Q6(ii) "Manage role types" link** in [`AssignRoleDialog.tsx`](packages/core/src/modules/customers/components/detail/AssignRoleDialog.tsx):
   - New optional prop `canManageRoleTypes?: boolean` (defaults to `false`).
   - Renders a `<Link>` to `/backend/config/customers` with a `Settings2` icon below the Role Type dropdown (step 1) and beside the "Change" button (step 2).
   - [`RolesSection`](packages/core/src/modules/customers/components/detail/RolesSection.tsx) reads `grantedFeatures` via `useBackendChrome()` and passes `canManageRoleTypes = hasFeature(granted, 'customers.settings.manage')` to the dialog — wildcard-aware per the feature-matching rule from `.ai/lessons.md`.

**Tests (all passing):**
- Unit (21 new/updated):
  - `displayName.test.ts` — 12 cases (dot/underscore/hyphen/plus separators, no-separator single word, internal casing preserved, null/empty/whitespace guards, no-`@` fallback, separator-only returns null, trim).
  - `RolesSection.test.tsx` — 3 new cases (person title "My roles with {name}", company title "Roles at {name}", generic fallback when `entityName` absent) + existing empty-dictionary CTA test.
  - `AssignRoleDialog.test.tsx` — 2 new cases (link visible with `canManageRoleTypes=true`, hidden by default).
- Regression sweep: **203 tests pass across 54 suites** (customers + audit_logs + shared commands + ui crud).
- Integration (Playwright): [`TC-CRM-045`](packages/core/src/modules/customers/__integration__/TC-CRM-045.spec.ts) — creates person + company fixtures, navigates to each detail page, asserts the renamed titles are visible, and verifies the entity-roles API response keeps `userName` typed `string | null`.
- Live preview end-to-end:
  - Assigned admin (whose `auth_users.name` is `NULL`) a role on the fixture company via API → `GET /api/customers/companies/<id>/roles` returned `"userName": "Admin"` (derived from `admin@acme.com`) instead of `null`. **Q5(a) verified live.**
  - Navigated to person detail page → "My roles with QA P5 Person {stamp}" rendered in the DOM on first paint. **Q6(i) verified live.**
  - Q6(ii) exercised via unit tests; integration test covers the end-to-end click.

**BC verdict — fully additive.**

| Surface | Change | Classification |
|--|--|--|
| BC #2 `userName` on entity-roles response | Type unchanged (`string \| null`); population rule adds email-local-part fallback before `null` | **Additive** |
| BC #7 `/api/customers/{people,companies}/{id}/roles` | Response schema unchanged | No-op |
| Internal `RolesSection` props | New optional `entityName` already existed; added `canManageRoleTypes` computed internally via `useBackendChrome()` | **Additive** |
| Internal `AssignRoleDialog` props | New optional `canManageRoleTypes?: boolean` defaulting to `false` | **Additive** |
| i18n keys | New `customers.roles.groupTitle.person`, `customers.roles.groupTitle.company`, `customers.roles.defaultEntityName.{person,company}`, `customers.roles.dialog.manageRoleTypes` — all additive; existing `customers.roles.groupTitle` fallback retained | **Additive** |

**Scope notes:**
- The "Manage role types" link points at `/backend/config/customers` (same target as the existing "Configure role types" fallback button). A deeper "/backend/config/dictionaries/{id}" URL is the suggested follow-up but out of scope; `CustomersConfigurationSections` already surfaces the dictionary editor via `DictionarySettings` on the same page.
- Company v2 (`createCompanyDaneFiremyGroups`) does not currently include `RolesSection` in its Zone 1 form. The roles experience on company pages lives inside the **People tab** via `CompanyPeopleSection`, which already passes `entityName`. Extending the Company v2 Zone 1 to include a roles group is out of Phase 5's scope.
- No backfill needed — the email-local-part fallback is computed at read time, so existing rows immediately show derived names without any data migration.

### Phase 6 — Filters + composer polish — [#1664](https://github.com/open-mercato/open-mercato/issues/1664), [#1660](https://github.com/open-mercato/open-mercato/issues/1660)

**Goal:** Four coordinated polish fixes that close out the Open Questions bundle:
- **Q8(a)**: stop silently dropping People/Companies filter values when a label round-trip mismatch occurs.
- **Q8(c)**: persist the advanced filter across refreshes / shared links.
- **Q7**: upgrade the `InlineActivityComposer` description to a labelled 3-row textarea so the composer no longer looks like a 1-line text input.
- **Q7**: add a "Hide week preview" toggle, persisted per entity kind, so users who find the `MiniWeekCalendar` distracting can collapse it without removing it for everyone.

**Scope correction during implementation:** Q8(a) as framed in the original spec ("switch from `type: 'tags'` to `type: 'select'`") was based on a misreading of the bug. `TagsInput` is already value-keyed (stores option `value`s, not labels). The real bug was in the deal page's `handleFiltersApply` + `syncFilterLabels` logic: those helpers rewrote `filterValues.people / .companies` to LABEL strings via `idToLabel` and then re-parsed them via `labelToId` on apply — any mismatch (case, whitespace, Unicode separator in composed labels) silently dropped the filter. The fix is simpler than a type swap: keep `type: 'tags'`, stop doing label round-tripping, and add `formatValue` so chips still render names. Q8(c) chose `filter[...]` instead of the spec's proposed `af=` param because the shape is already established on the API side (`serializeAdvancedFilter` / `deserializeAdvancedFilter`) — round-tripping the same encoding lossless without inventing a new one.

**Steps (implemented 2026-04-23):**

1. **Q8(a)** — [`packages/core/src/modules/customers/backend/customers/deals/page.tsx`](packages/core/src/modules/customers/backend/customers/deals/page.tsx):
   - `handleFiltersApply` now reads `values.people` / `values.companies` as **IDs directly** (with `isUuid` guard + dedupe). No more `labelToId` lookup that silently dropped mismatches.
   - Replaced `syncFilterLabels(key, ids, idToLabel)` with `syncFilterIds(key, ids)` — writes IDs into `filterValues` so there's only one source of truth.
   - Added `formatValue: (id) => peopleIdToLabel[id] ?? id` (and the equivalent for companies) on the `tags` filter defs so the `FilterBar` chips show readable names while the typeahead resolver catches up.
2. **Q8(c)** — same file:
   - Lazy `useState` initializer for `advancedFilterState` deserializes any `filter[...]` params present on the initial URL so a refresh or shared link restores the filter.
   - URL-sync `useEffect` now also writes `serializeAdvancedFilter(advancedFilterState)` into the URL alongside `search`, `personId`, `companyId`, `page`. Chose the existing `filter[...]` encoding over the spec's proposed `af=` to keep a single lossless shape across the API and the browser.
3. **Q7** — [`packages/core/src/modules/customers/components/detail/InlineActivityComposer.tsx`](packages/core/src/modules/customers/components/detail/InlineActivityComposer.tsx):
   - Description field is now an explicitly-labelled `<textarea>` with `rows={3}`, `min-h-[72px]`, and an autosize effect that grows up to a 200px cap as the user types.
   - New "Hide week preview" toggle (lucide `ChevronUp` / `ChevronDown`) next to a `THIS WEEK` overline header. Clicking swaps the label to "Show week preview" and conditionally renders the `MiniWeekCalendar`. Persists via the Phase 4 `usePersistedBooleanFlag` under key `om:inline-composer:week-preview:{entityType}` so the preference follows the user across records of the same kind but stays distinct per kind (person / company / deal).

**Tests (all passing):**
- Unit (4 new): [`InlineActivityComposer.test.tsx`](packages/core/src/modules/customers/components/detail/__tests__/InlineActivityComposer.test.tsx)
  - Textarea renders with `rows=3` + `min-h-[72px]` + an associated label.
  - Week calendar visible by default (`hideWeekPreview=false`).
  - Clicking "Hide week preview" unmounts the calendar, flips the toggle to "Show", and writes `'1'` to `om:inline-composer:week-preview:person`.
  - Preference key is scoped per entity kind (company/person/deal) so a company-side toggle doesn't leak into the deal composer.
- Regression: 207 core tests across 55 suites + 69 ui/crud tests — all green.
- Integration (Playwright, 3 new): `TC-CRM-046` (Q8a — personId filter narrows result set + chip shows name + removing chip widens), `TC-CRM-047` (Q8c — `filter[...]` URL round-trips through reload), `TC-CRM-048` (Q7 — composer 3-row textarea + week preview toggle + localStorage persistence).
- Live preview (all three verified end-to-end against the dev server):
  - Q8(a): `?personId=<uuid>` URL → Keeper deal visible, Distractor filtered out. Chip reads `"People: QA P6 Keeper 1776980467 ×"` (name, not UUID). Clicking the chip re-widens the list.
  - Q8(c): `?filter[logic]=and&filter[conditions][0][field]=title&filter[conditions][0][op]=contains&filter[conditions][0][value]=Keeper Deal` URL → list correctly narrows; `window.location.reload()` → URL still carries the same params, list stays narrowed.
  - Q7: composer renders a `Description` label + 3-row textarea + "Hide week preview" toggle; clicking hides the calendar, sets `localStorage['om:inline-composer:week-preview:person']='1'`, and after a full `window.location.reload()` the calendar is still hidden (Phase 4's flicker-free hook) with "Show week preview" visible.

**BC verdict — fully additive.**

| Surface | Change | Classification |
|--|--|--|
| BC #7 `/api/customers/deals` | No change; URL hydration uses the existing `filter[...]` encoding | No-op |
| Deal list browser URL | Adds `filter[...]` params on top of `search / personId / companyId / page`; all existing params unchanged | **Additive** |
| `InlineActivityComposer` props | Unchanged; internal layout + localStorage key new | No-op at boundary |
| localStorage keys | New namespace `om:inline-composer:week-preview:{entityType}` | **Additive** |
| i18n keys | New `customers.activityComposer.{descriptionLabel, weekPreviewTitle, hideWeekPreview, showWeekPreview}` | **Additive** |

**Scope notes:**
- Q8(b) from the spec (dictionary `filterKey` normalisation — `pipeline_stage` vs `pipelineStage`) was flagged as a bridge-release follow-up in the resolved-decisions matrix. Not in this phase.
- The advanced filter URL sync uses `filter[...]` rather than the proposed `af=` param — chose the existing encoding over inventing a new one. Documented in the BC table above.

---

## Integration Test Coverage

| Phase | Test file | Scenarios |
|-------|-----------|-----------|
| 1 | `__integration__/TC-CRM-HEADER-001-history-icon-person.spec.ts` | Open history from person header |
| 1 | `__integration__/TC-CRM-HEADER-002-history-icon-company.spec.ts` | Open history from company header |
| 1 | `__integration__/TC-CRM-HEADER-003-history-icon-deal.spec.ts` | Open history from deal header |
| 2 | `__integration__/TC-CRM-CHANGELOG-001-deal-note-appears.spec.ts` | Note on deal → appears in deal changelog |
| 2 | `__integration__/TC-CRM-CHANGELOG-002-related-note-not-duplicated.spec.ts` | Note appears once, not duplicated in person/company changelog |
| 3 | `__integration__/TC-CRM-UNDO-001-scheduled-activity.spec.ts` | Schedule activity → undo chip shows → undo works |
| 3 | `__integration__/TC-CRM-UNDO-002-logged-activity-parity.spec.ts` | Log past activity → undo still works (regression guard) |
| 4 | `packages/ui/src/backend/crud/__integration__/TC-UI-COLLAPSE-001-persistence.spec.ts` | Collapse Zone 1 → refresh → stays collapsed (no flash) |
| 5 | `__integration__/TC-CRM-ROLES-001-username-fallback.spec.ts` | User with null `auth_users.name` → UI shows derived name, not raw email |
| 5 | `__integration__/TC-CRM-ROLES-002-manage-role-types-link.spec.ts` | Assign Role dialog → "Manage role types" link visible for user with `customers.settings.manage` |
| 6 | `__integration__/TC-CRM-DEALS-001-people-filter.spec.ts` | People filter round-trips value, doesn't silently drop |
| 6 | `__integration__/TC-CRM-DEALS-002-advanced-filter-url.spec.ts` | Advanced filter persists through refresh |
| 6 | `__integration__/TC-CRM-COMPOSER-001-multiline.spec.ts` | Inline composer description supports 3+ rows; week preview toggle works |

---

## Migration & Backward Compatibility

Per resolved decisions, every phase is additive. Summary per contract surface:

| BC # | Surface | Phase(s) | Change | Verdict |
|------|---------|----------|--------|---------|
| #2 (types) | `userName` on entity-roles response | 5 | Population rule changes (null → derived from email local-part); field type stays `string \| null` | **Additive-safe** |
| #3 (fn signatures) | `usePersistedBooleanFlag(key, defaultValue)` | 4 | Signature unchanged; internal implementation swaps `useEffect` → `useSyncExternalStore` | **No change** |
| #5 (events) | Customers events | — | No event added/removed/renamed | **No change** |
| #6 (spot IDs) | Header injection spots | 1 | No spots renamed; bespoke headers stay bespoke | **No change** |
| #7 (API routes) | `/api/customers/interactions` | 3 | Adds `x-om-operation` response header (additive) | **Additive-safe** |
| #7 (API routes) | `/api/audit_logs/audit-logs/actions` | 2 | New optional query behavior (server-side matches generic `related_resource_kind/resource_id` when `includeRelated=true`) | **Additive-safe** |
| #7 (API routes) | `/api/customers/deals` (list) | 6 | Existing `filter[...]` query-string params now round-trip advanced filters from the UI; existing params unchanged | **Additive-safe** |
| #8 (DB schema) | `action_logs` | 2 | New nullable `related_resource_kind` and `related_resource_id` columns plus composite btree index `(tenant_id, related_resource_kind, related_resource_id, created_at)` — no column/table rename/remove | **Additive-safe** |
| #10 (ACL) | `customers.settings.manage` | 5 | Used (not created) for the Manage Role Types link gate | **No change** |

No deprecation protocol required — no surface renamed, removed, or narrowed. RELEASE_NOTES.md still receives a user-facing note about each fix.

---

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 1 — Header parity | Done | 2026-04-23 | New `ObjectHistoryButton` wrapper and `SendObjectMessageDialog` triggers integrated into Person/Company/Deal headers; 80 unit tests pass (30 suites); Playwright `TC-CRM-039/040/041` committed; live preview confirms Person + Company render 32×32 outline icon matching Figma `105:57` and panel opens with real audit entries |
| Phase 2 — Audit attribution | Done | 2026-04-23 | Pivoted from jsonb-path filter to generic denormalized related-resource columns (encryption blocks raw jsonb filter). 93 audit_logs + customers-detail + customers-commands tests pass; 70 shared command-bus tests pass; Playwright `TC-CRM-042` committed; live curl verified deal changelog returns notes linked only via `dealId` |
| Phase 3 — Undo parity | Done | 2026-04-23 | Root cause was **NOT** the root interactions POST (CRUD factory auto-wires header) — real gap was in `/complete` and `/cancel` sub-routes that discarded `logEntry`. Extracted shared `withOperationMetadata` helper, wired into both sub-routes, deduped entity-roles factory to reuse it. 140 tests pass across 38 suites (incl. 4 new unit cases); Playwright `TC-CRM-043` asserts all three interaction write paths emit the header + undo accepts their tokens; live curl confirmed complete→undo returns HTTP 200 |
| Phase 4 — Persistence hydration | Done | 2026-04-23 | Rewrote `usePersistedBooleanFlag` with `useSyncExternalStore` so the first render reflects localStorage synchronously. 9 unit cases pass (incl. first-render flicker regression guard + same-tab sync); 69 ui/crud tests + 84 customers-detail tests remain green; Playwright `TC-CRM-044` committed; live preview screenshot shows correct expanded/collapsed layout from the first paint after seeding localStorage to `'0'` or `'1'` and refreshing |
| Phase 5 — Roles ergonomics | Done | 2026-04-23 | Q5(a) server-side `userName` fallback from email local-part (verified live: `admin@acme.com` with null `auth_users.name` now returns `"userName": "Admin"`); Q6(i) section rename to "My roles with {name}" / "Roles at {name}" with `entityName` threaded through formConfig (verified in DOM); Q6(ii) "Manage role types" link in `AssignRoleDialog` gated by `customers.settings.manage` via wildcard-aware `hasFeature` matcher. 203 tests pass across 54 suites (12 new displayName + 3 RolesSection + 2 AssignRoleDialog). Playwright `TC-CRM-045` committed. |
| Phase 6 — Filters + composer | Done | 2026-04-23 | Q8(a) deal-list people/companies filters no longer silently drop values — handler reads IDs directly, chips render names via `formatValue`; Q8(c) `advancedFilterState` round-trips via `filter[...]` URL params through refresh; Q7 `InlineActivityComposer` upgraded with labelled 3-row autosize textarea + "Hide week preview" toggle persisted per entity kind via the Phase 4 `usePersistedBooleanFlag` hook. 207 core tests across 55 suites + 69 ui/crud tests remain green; 4 new InlineActivityComposer unit cases committed. Playwright `TC-CRM-046/047/048` committed. All three behaviours verified end-to-end in the dev server (chip name rendering, URL reload round-trip, composer layout + toggle persistence). |

### Phase 1 — Detailed Progress

- [x] Create `ObjectHistoryButton` wrapper at [ObjectHistoryButton.tsx](packages/core/src/modules/customers/components/detail/ObjectHistoryButton.tsx) — uses shared `VersionHistoryAction` with Figma-matched `size-8 rounded-md border bg-background` overrides
- [x] Integrate into [PersonDetailHeader.tsx](packages/core/src/modules/customers/components/detail/PersonDetailHeader.tsx) (`resourceKind="customers.person"`)
- [x] Integrate into [CompanyDetailHeader.tsx](packages/core/src/modules/customers/components/detail/CompanyDetailHeader.tsx) (`resourceKind="customers.company"`)
- [x] Integrate into [DealDetailHeader.tsx](packages/core/src/modules/customers/components/detail/DealDetailHeader.tsx) (`resourceKind="customers.deal"`, `includeRelated` for Phase 2 join)
- [x] Integrate `SendObjectMessageDialog` into the same Person/Company/Deal header action clusters with `customers` object context and 32px outline icon-button styling
- [x] Unit test [ObjectHistoryButton.test.tsx](packages/core/src/modules/customers/components/detail/__tests__/ObjectHistoryButton.test.tsx) — 3 cases (render, className override, empty-resourceId guard)
- [x] Update existing [PersonDetailHeader.test.tsx](packages/core/src/modules/customers/components/detail/__tests__/PersonDetailHeader.test.tsx), [CompanyDetailHeader.test.tsx](packages/core/src/modules/customers/components/detail/__tests__/CompanyDetailHeader.test.tsx), and [DealDetailHeader.test.tsx](packages/core/src/modules/customers/components/detail/__tests__/DealDetailHeader.test.tsx) to assert Send-message + History actions are present
- [x] Integration tests [TC-CRM-039.spec.ts](packages/core/src/modules/customers/__integration__/TC-CRM-039.spec.ts) (person), [TC-CRM-040.spec.ts](packages/core/src/modules/customers/__integration__/TC-CRM-040.spec.ts) (company), [TC-CRM-041.spec.ts](packages/core/src/modules/customers/__integration__/TC-CRM-041.spec.ts) (deal) — each creates fixture, navigates to detail page, clicks History, asserts panel opens
- [x] Build packages + clear `.next` + live preview: Person header + Company header render the outline icon-button (32×32, rounded-md, border) and the panel opens with real audit entries
- [x] i18n: existing `audit_logs.version_history.title` covers history aria-label; new `*.actions.sendMessage` keys added across en/pl/es/de

**Scope note (vs. spec Phase 1 step 5):** The ••• More-menu migration (moving Delete inside a dropdown per Figma `105:57` Note "Usuń hidden") is deferred to a follow-up. Phase 1 ships Send message + History icon actions; Delete remains an explicit `IconButton`.

**BC verdict:** All additive. No surface renamed/removed. Locale keys are additive. No new dependency.

---

## Changelog

- **2026-04-23** — Skeleton spec + 8 Open Questions posted. Awaiting answers before expanding phases.
- **2026-04-23** — Pre-implementation analysis completed ([ANALYSIS-2026-04-23-crm-post-upgrade-bug-fixes.md](.ai/specs/analysis/ANALYSIS-2026-04-23-crm-post-upgrade-bug-fixes.md)). Spec updated for: Q3 (verified error string is not in `interactions.ts`, preview repro scope refined), Q4 (verified `usePersistedBooleanFlag` is SSR-safe; root cause likely `pageType` key audit, not hook rewrite), Q5 (corrected `User.name` schema note; option (c) marked as BC-blocked per contract #2), Q8 (line 698 → lines 699-710). Added placeholder "Migration & Backward Compatibility" section with forward-looking BC constraints.
- **2026-04-23** — Open Questions gate closed. Q1=(a), Q2=(d), Q3=API-header-fix (new option outside the original list), Q4=hook-level hydration fix, Q5=(a), Q6=(i)(α)+(ii)(β), Q7=(a)(i) modified, Q8=(a)+(c). Design decisions anchored to Figma frames `105:4`, `105:57`, `105:195`, `105:227`, `46:9361`, `521:2`, `545:2`. Phases 1-6 sequenced; Phase 1 fully detailed, Phases 2-6 outlined. Per-phase BC verdicts recorded — all additive-safe.
- **2026-04-23** — **Phase 1 implemented.** Added `SendObjectMessageDialog` triggers and `ObjectHistoryButton` wrapper to Person/Company/Deal detail headers. 80 customer-detail unit tests pass (30 suites); 3 Playwright integration tests committed (`TC-CRM-039/040/041`). Live preview verified: Person and Company headers render the 32×32 outline History icon matching Figma `105:57`; clicking opens the Version History panel populated with real audit entries. Scope note: ••• more-menu migration of Delete deferred to a follow-up — out of scope for the minimal Phase 1 fix.
- **2026-04-23** — **Phase 2 implemented with encryption-driven pivot.** Original Q2=(d) plan (raw `snapshot_after->>'dealId'` jsonb-path filter) was blocked at runtime: `action_logs.snapshot_after` is encrypted at rest, so the jsonb expression returns NULL. Pivoted to generic denormalized plaintext related-resource columns populated by the command `buildLog` hooks (additive per BC #2/#7/#8). Added `relatedResourceKind`/`relatedResourceId` to `CommandLogMetadata` + `actionLogCreateSchema` + `ActionLog` entity + command-bus plumbing; updated `buildListQuery` to add a third OR branch on `related_resource_kind/related_resource_id` when `includeRelated=true`; populated `customers.deal` from the three customer-comment commands (create/update/delete). Migration `Migration20260423202109.ts` adds the columns + composite index `(tenant_id, related_resource_kind, related_resource_id, created_at)`. 93 core tests + 70 shared command tests pass; Playwright `TC-CRM-042` committed. Live curl verified deal changelog returns comments whose `parent_resource_kind` is `customers.person` but whose `dealId` matches. Backfill of historical rows flagged as follow-up (not in Phase 2 scope).
- **2026-04-23** — **Phase 3 implemented with a scope correction.** Initial Q3 diagnosis blamed the root `POST /api/customers/interactions` route for not emitting `x-om-operation`. Verified during implementation that's not the case — `makeCrudRoute` auto-wires the header and a direct curl test confirmed scheduled-creation → undo already worked end-to-end. Real gap was in the two custom sub-routes: `/api/customers/interactions/complete` and `/api/customers/interactions/cancel`. Both discarded the command-bus `logEntry` and returned `NextResponse.json({ ok: true })` with no undo header, so completing a scheduled activity produced a real audit log but the client's operation store never learned about it. Extracted a shared `withOperationMetadata` helper at `packages/core/src/modules/customers/lib/operationMetadata.ts`, wired it into both sub-routes, and deduped `entity-roles-factory.ts` (which had a local copy). 140 tests pass across 38 suites (incl. 4 new unit cases); Playwright `TC-CRM-043` asserts the header + undo round-trip for create + complete + cancel. Live curl confirmed `complete → /audit-logs/actions/undo` returns HTTP 200.
- **2026-04-23** — **Phase 4 implemented.** Rewrote `usePersistedBooleanFlag` with `useSyncExternalStore` to eliminate the hydration flicker on refresh. `getSnapshot` now reads localStorage synchronously on every client render; `getServerSnapshot` returns `defaultValue` so SSR stays coherent and React's built-in store-hook hydration bridge suppresses any mismatch warning. Added a local `EventTarget` broadcaster so same-tab instances of the hook see each other's writes (previously only cross-tab `storage` events propagated). Incidental write-on-mount of `defaultValue` removed — behaviour improvement acknowledged in the original test comment. 9 unit cases pass (incl. a new "first-render value reflects localStorage — no flicker" assertion and a same-tab sync test); 69 ui/crud + 84 customers-detail regression tests remain green. Playwright `TC-CRM-044` committed. Live preview verified: round-tripped collapsed/expanded seeds through `localStorage.setItem(...)` + `window.location.reload()` and observed the correct layout on the first paint both ways.
- **2026-04-23** — **Phase 5 implemented.** Three coordinated fixes for the CRM roles experience: (Q5a) server-side `userName` fallback — new helper `deriveDisplayNameFromEmail(email)` in `packages/core/src/modules/customers/lib/displayName.ts` splits the local-part on `. _ - +`, capitalises each segment, and feeds `entity-roles-factory.ts` so users with null `auth_users.name` now surface as e.g. "John Doe" from `john.doe@acme.com` instead of raw email. Response field stays `string \| null` per BC #2. (Q6i) Section rename in `RolesSection.tsx` to "My roles with {name}" (person) / "Roles at {name}" (company); `formConfig.tsx` updated to thread `entityName` through the two legacy group builders that weren't passing it. (Q6ii) New optional `canManageRoleTypes` prop on `AssignRoleDialog` renders a "Manage role types" link with Settings2 icon below the role-type dropdown (step 1) and beside the "Change" button (step 2), linking to `/backend/config/customers`. Gate computed in `RolesSection` via `useBackendChrome()` + wildcard-aware `hasFeature(..., 'customers.settings.manage')`. 203 tests pass across 54 suites (12 new displayName + 3 RolesSection + 2 AssignRoleDialog cases). Playwright `TC-CRM-045` committed. Live curl confirmed the `userName` derivation end-to-end; DOM query confirmed the renamed title on first paint. Deeper per-dictionary URL deep-link and extending roles into Company v2 Zone 1 flagged as follow-ups.
- **2026-04-23** — **Phase 6 implemented — spec complete.** Four polish fixes landed together: (Q8a) Deal-list People/Companies filters stop silently dropping values. Root cause was **not** a filter-type mismatch — `TagsInput` was already value-keyed. The bug was that `handleFiltersApply` + `syncFilterLabels` round-tripped through `idToLabel` / `labelToId` and any mismatch dropped the filter. Replaced with straight ID reads + `formatValue` on the filter defs so chips still render names. (Q8c) `advancedFilterState` round-trips through the URL via the existing `filter[...]` encoding (chose this over the spec's proposed `af=` for lossless API ↔ browser symmetry). Lazy `useState` deserialiser rehydrates on mount; URL-sync `useEffect` writes the serialized params alongside `search/personId/companyId/page`. (Q7) `InlineActivityComposer` description upgraded to a labelled 3-row autosize `<textarea>` with a 200px cap; new "Hide week preview" toggle using lucide `ChevronUp`/`ChevronDown` and the Phase 4 `usePersistedBooleanFlag` hook under key `om:inline-composer:week-preview:{entityType}` so the preference follows the user across records of the same kind but stays distinct between company / person / deal composers. 4 new `InlineActivityComposer` unit cases + 3 new Playwright specs (`TC-CRM-046/047/048`). Regression sweep: 207 core + 69 ui/crud tests remain green. Live preview verified every behaviour end-to-end against the dev server: `?personId=<uuid>` narrows the list with the chip showing a readable name; `?filter[...]` survives a `window.location.reload()`; composer textarea has `rows=3` + label; toggling "Hide week preview" unmounts the calendar, stores `'1'` in localStorage, and after a full reload the calendar stays hidden with "Show week preview" visible.
- **2026-04-23** — **Spec complete.** All six phases implemented, all resolved decisions honoured, all BC verdicts additive. Bundled follow-ups flagged inline: historical related-resource backfill subscriber (Phase 2), ••• more-menu migration of Delete per Figma `105:57` (Phase 1), deeper per-dictionary URL deep-link (Phase 5), Company v2 Zone 1 roles panel (Phase 5), dictionary `filterKey` normalisation bridge release (Phase 6).
