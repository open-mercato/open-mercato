# SPEC-072: CRM Detail Pages UX Enhancements

**Created:** 2026-04-06
**Module:** `customers`, `sales`
**Status:** Draft
**Author:** Oliwia Zielińska (UX), Maciej (dev)
**Related:** SPEC-046 (Customer Detail v2), SPEC-047 (Sales Document Detail v2), SPEC-041 (UMES), SPEC-046b (Interactions Unification)

---

## Revision History

| Version | Date | Summary |
|---------|------|---------|
| 1.0 | 2026-04-06 | Initial spec: collapsible CrudForm groups, zone collapse, inline activity composer, roles, pipeline stepper, closure flow, WCAG 2.1 AA. |
| 1.1 | 2026-04-12 | Added Enhancements 6–8 during implementation: dashboard widgets, AI action chips, per-user labels, dictionary kind settings, person-company roles UI, decision-makers footer, mini week calendar, entity-scoped tag dialogs, activity log tab, changelog tab. |
| 1.2 | 2026-04-19 | Addressed CR 5 feedback: DS token migration across CRM detail screens, unit tests for persistence hooks, i18n wrapping in new API error responses, `findWithDecryption` on attachments route, minor a11y/log-level/docs cleanups. |

## TLDR

**Key Points:**

- UX layer on top of implemented SPEC-046 (company/person cards) and draft SPEC-047 (quote/order cards)
- Collapsible CrudForm groups with persistent user preference (localStorage → API)
- Collapsible Zone 1 panel — entire left section (CrudForm) can collapse to a strip, giving Zone 2 full width (inspired by Tilio)
- Inline activity composer (call/email/meeting/note) replacing tab-only access in Zone 2
- Multi-role assignment section on company/person cards (replaces single "responsible person")
- Deal stage progress bar with click-to-advance on sales document cards
- Deal closure flow with won/lost outcome + loss reason dictionary
- Activity timeline filtering and planned-activities pinning in Zone 2
- WCAG 2.1 AA compliance across all new components

**Scope:**

- Modified: company-v2, person-v2 detail pages (SPEC-046 Zone 1 + Zone 2)
- Modified: sales document-v2 detail page (SPEC-047 Zone 1 + Zone 2)
- New components (Phase 1–5): `CollapsibleGroup`, `CollapsibleZoneLayout`, `InlineActivityComposer`, `RolesSection`, `PipelineStepper` (stage progress bar), `ConfirmDealLostDialog` / `DealLostSummaryDialog` / `DealWonPopup` / `DealClosureActionBar` (closure flow), `ActivityTimelineFilters`
- New components (Phase 6–8, added during implementation — see "Additional UX Iterations"): Dashboard widgets, AI Action Chips, per-user Labels UI, Dictionary Kind Settings UI, Person-Company Roles UI, Decision Makers Footer, Mini Week Calendar, Entity-scoped Tag Dialogs, Activity Log Tab, Changelog Tab
- New API endpoints: roles CRUD, activity filtering, per-user labels CRUD/assign, person-company link CRUD, dictionary entry reorder/set-default, dictionary kind settings CRUD, audit-log projections export
- New UMES injection spots for roles, stage bar, activity composer, closure dialog

**Concerns:**

- Collapsible groups must not break CrudForm validation (collapsed fields must still validate on submit)
- Inline activity composer saves independently from CrudForm (same pattern as tags in SPEC-046)
- Stage progress bar requires pipeline stage definitions from SPEC-028 (Multiple CRM Pipelines)

---

## Scope Classification

This spec contains two categories of changes:

### UX-only enhancements
- Collapsible CrudForm groups
- Collapsible Zone 1 panel
- Inline activity composer
- Activity timeline filtering UI

These changes primarily affect presentation, interaction flow, and client-side behavior. No new database entities, no API contract changes, no migrations.

### Product/domain enhancements
- Multi-role assignment (new entity, migration, API, ACL)
- Deal stage progress bar with closure flow (new columns on sales_documents, extended PATCH payload)

These changes introduce or extend business data, permissions, API contracts, and persistence. They should be estimated and reviewed accordingly, even if shipped under the same UX initiative.

---

## Workstream Dependencies

- **SPEC-046** (implemented): Provides the CrudForm two-zone layout, contentHeader, Zone 2 tabs, and UMES injection spots for company/person pages. This spec extends those pages without modifying the core CrudForm contract.
- **SPEC-047** (draft): Provides the same pattern for sales documents. Stage progress bar and deal closure extend the document contentHeader and add new component groups.
- **SPEC-046b** (implemented): Defines canonical customer interactions (activities/todos). Inline activity composer and timeline filtering consume this data model.
- **SPEC-028** (implemented): Multiple CRM Pipelines — provides pipeline stage definitions consumed by the stage progress bar.

---

## Overview

SPEC-046 and SPEC-047 established the technical foundation for detail pages: CrudForm with whole-document save, UMES injection slots, and Zone 2 related data tabs. However, user testing and competitive analysis (Bitrix24, Pipe Drive, Tilio, Odoo) revealed critical UX gaps:

1. **Information overload** — all CrudForm groups render expanded simultaneously. Users with many custom fields see a wall of data with no way to focus.
2. **Activity creation friction** — adding a call/email/meeting note requires navigating to Zone 2 Activities tab, which is below the fold. CRM power users need < 2 clicks to log an activity.
3. **Single responsible person** — real CRM workflows have multiple roles per entity (sales owner, service owner, account manager). Current model supports only one.
4. **No visual deal progression** — sales document status is a dropdown. Users cannot see where a deal sits in the pipeline at a glance or advance it with one click.
5. **Unfiltered activity history** — Zone 2 Activities tab shows all interactions chronologically with no filtering by type or date range. Users with 100+ activities per entity cannot find relevant history.

---

## Problem Statement

### Current State (post SPEC-046/047)

1. **CrudForm groups are static** — groups render as open cards with no collapse/expand toggle. On entities with many custom fields, the form exceeds 3 screen heights.
2. **Activities tab is below the fold** — Zone 2 tabs sit below the CrudForm. Users must scroll past all form groups to reach the activity creation UI. This is the #1 workflow blocker reported in user feedback.
3. **One `assignedTo` field** — company and person entities have a single owner field. In practice, a company has a sales owner, service owner, and potentially project owner — each needing visibility on the card.
4. **Sales document status is a flat select** — no visual pipeline representation. Users cannot see previous/next stages, cannot click to advance, and have no closure flow with outcome tracking.
5. **Activities tab has no filters** — all activity types (call, email, meeting, note, system events) render in one chronological list. No way to filter by type, date range, or show only planned/overdue items.

### Goal

Layer UX enhancements onto the existing SPEC-046/047 architecture without breaking:
- CrudForm whole-document save semantics
- UMES injection slot contracts
- Zone 1 / Zone 2 separation
- API backward compatibility

This spec does not redefine:
- CrudForm save ownership or payload structure
- Canonical interaction model from SPEC-046b
- Pipeline definition ownership from SPEC-028
- Global permission model outside explicitly listed additions (roles ACL)

Each enhancement is independently deployable as a phase.

---

## Out of Scope

The following are explicitly out of scope for this spec:
- Redesign of CrudForm core save contract or payload builder
- Replacing the canonical interaction model (SPEC-046b)
- Pipeline configuration authoring (creating/editing pipelines and stages)
- Reporting changes for role ownership or deal closure analytics
- Workflow automations triggered by deal closure (e.g. auto-create project on won)
- Mobile redesign beyond preserving usable stacked layout
- Cross-device persistence of collapse/filter preferences (v1 = localStorage only)
- Onboarding flow or guided tours for new CRM users

---

## Proposed Solution

### Enhancement 1: Collapsible CrudForm Groups

#### Architecture

Wrap each CrudForm group in a `<CollapsibleGroup>` component that adds a chevron toggle to the group header.

```
┌─────────────────────────────────────┐
│ ▼ Details                       [▲] │  ← click toggles collapse
│   displayName: [Acme Corp        ] │
│   primaryEmail: [info@acme.com   ] │
│   primaryPhone: [+48 500 123 456 ] │
│   status: [Active ▾]               │
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│ ► Profile                       [▼] │  ← collapsed, shows only header
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│ ► Custom Fields                 [▼] │  ← collapsed
└─────────────────────────────────────┘
```

#### Behavior

| Rule | Detail |
| ---- | ------ |
| Default state | All groups expanded on first visit. After user collapses, preference is saved. |
| Persistence | `localStorage` key: `om:collapsible:{pageType}:{groupId}` → `boolean`. Future: migrate to user preferences API. |
| Validation | Collapsed groups with validation errors auto-expand on submit attempt. Error badge shows on collapsed header: `► Profile (2 errors)`. |
| Animation | Expand/collapse: 200ms ease-out. Respects `prefers-reduced-motion`. |
| CrudForm contract | No change to CrudForm internals. `CollapsibleGroup` wraps the group's rendered output. Hidden fields remain in DOM (not unmounted) so form state is preserved. Collapsed groups must participate in validation exactly as expanded groups. Collapse state is purely presentational and must not alter form registration, dirty state, or submit payload. |

#### Component

```tsx
interface CollapsibleGroupProps {
  groupId: string;
  title: string;
  pageType: string; // e.g. 'company', 'person', 'order'
  defaultExpanded?: boolean;
  errorCount?: number;
  children: ReactNode;
}
```

#### Files

| File | Action |
| ---- | ------ |
| `packages/core/src/components/CrudForm/CollapsibleGroup.tsx` | New — wraps group content |
| `packages/core/src/components/CrudForm/useGroupCollapse.ts` | New — hook for collapse state + localStorage persistence |
| `packages/core/src/components/CrudForm/CrudFormGroups.tsx` | Modified — wrap each group renderer with `<CollapsibleGroup>` |

---

### Enhancement 1b: Collapsible Zone 1 Panel (inspired by Tilio)

#### Architecture

Entire Zone 1 (CrudForm) can be collapsed to a narrow strip, giving Zone 2 (tabs/history) full page width. Inspired by Tilio's left-panel collapse arrow.

```
EXPANDED (default):                          COLLAPSED:
┌──────────────────┬───────────────────┐    ┌──┬────────────────────────────────┐
│ Zone 1 (40%)     │ Zone 2 (60%)      │    │◄ │ Zone 2 (100% width)            │
│                  │                    │    │  │                                │
│ [Szczegóły]      │ [Notatki|Aktyw..] │ →  │  │ [Notatki|Aktywności|Deale...]  │
│ displayName      │                   │    │  │                                │
│ email            │ timeline...       │    │  │ timeline with full width...    │
│ phone            │                   │    │  │                                │
│ ...              │                   │    │  │                                │
│            [►]   │                   │    │  │                                │
└──────────────────┴───────────────────┘    └──┴────────────────────────────────┘
                                              ↑
                                         click [►] to expand back
```

#### Behavior

| Rule | Detail |
| ---- | ------ |
| Toggle | Arrow button `[◄]` at the right edge of Zone 1. Click → Zone 1 collapses to ~48px strip showing only the arrow `[►]`. |
| Collapsed strip | Shows entity name vertically rotated (or truncated horizontal) + expand arrow. Enough to identify which entity you're on. |
| Zone 2 expansion | When Zone 1 collapsed, Zone 2 takes `flex: 1` full width. Activity timeline, notes, tables get more horizontal space — especially useful for wide data tables (deals, activities). |
| Use case | CRM power users who opened the card, already know the data, and want to focus on working the account — logging activities, reviewing history, managing deals. They don't need to see 15 form fields while doing that. |
| Persistence | `localStorage` key: `om:zone1-collapsed:{pageType}` → `boolean`. |
| Animation | Slide transition 250ms ease-out. Respects `prefers-reduced-motion`. |
| Mobile | Not applicable — on mobile (<768px) layout is already stacked vertically, no side-by-side zones. |

#### Focus and validation when collapsed

- If keyboard focus is currently inside Zone 1 and the user collapses it, focus moves to the Zone 1 expand button.
- If CrudForm validation errors exist in Zone 1 while collapsed, the collapsed strip shows an error badge with count (e.g. "2 errors").
- Submitting with Zone 1 collapsed auto-expands it if the first blocking error is inside Zone 1.
- Collapsing Zone 1 never suppresses validation visibility.

#### Component

```tsx
interface CollapsibleZoneLayoutProps {
  zone1: ReactNode;
  zone2: ReactNode;
  entityName: string;          // shown in collapsed strip
  pageType: string;            // for localStorage key
  zone1DefaultWidth?: string;  // default: '40%'
}
```

#### Files

| File | Action |
| ---- | ------ |
| `packages/core/src/components/CrudForm/CollapsibleZoneLayout.tsx` | New — wrapper that manages Zone 1 expand/collapse |
| `packages/core/src/components/CrudForm/useZoneCollapse.ts` | New — hook for zone collapse state + persistence |
| Company v2 page, Person v2 page | Modified — wrap existing Zone 1 + Zone 2 in `<CollapsibleZoneLayout>` |
| Sales document v2 page | Modified — same wrapper |

---

### Enhancement 2: Inline Activity Composer

#### Architecture

A compact activity creation widget injected into the **Zone 2 header area** (above tabs, below CrudForm Zone 1). Uses UMES injection spot `detail:customers.company:tabs` rendered as a sticky bar above the tab content.

```
┌──────────────────────────────────────────────────────────┐
│ Zone 1: CrudForm (company fields)                        │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│ INLINE ACTIVITY COMPOSER (sticky)                        │
│                                                          │
│  [📞 Call] [✉️ Email] [🤝 Meeting] [📝 Note]              │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │ What happened? [________________________] 📅 Today │  │
│  │                                    [Save activity] │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│ Zone 2: [Notes] [Activities] [Deals] [People] [Tasks]    │
│ ...                                                      │
└──────────────────────────────────────────────────────────┘
```

#### Behavior

| Rule | Detail |
| ---- | ------ |
| Trigger | Click one of 4 type icons. Composer expands inline (no modal/popup). |
| Fields | Type (pre-selected by icon), description (text), date (defaults to now), scheduled date (optional, for future activities). |
| Save | Independent from CrudForm — calls `POST /api/customers/interactions` (SPEC-046b contract). Does NOT dirty the CrudForm. |
| After save | Activity appears in Zone 2 Activities tab. Toast confirmation: "Aktywność zapisana" (action-specific, not generic "Saved"). Composer collapses back to icon row. |
| Scope | Bound to current entity: `{ entityType: 'company' | 'person', entityId: string }`. |

#### Form ownership

The InlineActivityComposer is **not** a CrudForm subsection. It is an independent action surface colocated on the detail page.

Implications:
- It maintains its own validation state (description required, date required).
- It has its own save lifecycle (`POST /api/customers/interactions`).
- It does not participate in CrudForm dirty tracking.
- It must not block CrudForm save.
- CrudForm validation must not block activity creation.
- After save, the page should use optimistic prepend into the local activity timeline if the interaction response payload is sufficient. Fallback: refetch Activities tab data. Full page reload is never acceptable.

#### Activity Types (fixed set, per meeting decision)

| Type | Icon | API value |
| ---- | ---- | --------- |
| Call | 📞 | `call` |
| Email | ✉️ | `email` |
| Meeting | 🤝 | `meeting` |
| Note | 📝 | `note` |

#### Component

```tsx
interface InlineActivityComposerProps {
  entityType: 'company' | 'person' | 'deal';
  entityId: string;
  onActivityCreated?: () => void; // refresh Zone 2 Activities tab
}
```

#### API

Uses existing SPEC-046b interactions endpoint:

```
POST /api/customers/interactions
{
  "entityType": "company",
  "entityId": "uuid",
  "type": "call",           // call | email | meeting | note
  "description": "Discussed Q2 contract renewal",
  "occurredAt": "2026-04-06T14:30:00Z",
  "scheduledAt": null        // null = already happened, date = planned
}
```

#### Files

| File | Action |
| ---- | ------ |
| `packages/core/src/modules/customers/components/detail/InlineActivityComposer.tsx` | New |
| `packages/core/src/modules/customers/components/detail/ActivityTypeSelector.tsx` | New — icon row component |
| Company v2 page, Person v2 page | Modified — render composer between Zone 1 and Zone 2 |
| Sales document v2 page | Modified — same composer for deal context |

---

### Enhancement 3: Multi-Role Assignment Section

#### Architecture

New CrudForm component group "roles" in Zone 1 (column 1, below "details" group) on company and person cards.

```
┌─────────────────────────────────────┐
│ ▼ Roles                            │
│                                     │
│  Sales Owner:    [Jan Kowalski  ✕]  │
│  Service Owner:  [— assign —    ▾]  │
│  Account Mgr:    [Anna Nowak    ✕]  │
│                                     │
│  [+ Add role]                       │
└─────────────────────────────────────┘
```

#### Data Model

New entity: `customer_entity_roles`

| Column | Type | Notes |
| ------ | ---- | ----- |
| `id` | uuid | PK |
| `entity_id` | uuid | FK → customer entity (company or person) |
| `user_id` | uuid | FK → staff user |
| `role_type` | varchar | Dictionary-driven: `sales_owner`, `service_owner`, `account_manager`, custom |
| `tenant_id` | uuid | Multi-tenant scoping |
| `organization_id` | uuid | Org scoping |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

**Unique constraint:** `(entity_id, role_type)` — one user per role type per entity.

#### v1 constraint

In v1, each role type can be assigned to at most one user per entity. Multiple assignees per role type (e.g. two account managers) are explicitly out of scope for this spec. If needed later, this will require revisiting both the unique constraint and the UI (single select → multi-select per role row).

#### Why roles are managed outside CrudForm

Roles are intentionally managed outside CrudForm save because:
- Role assignments are relational records (join table), not simple scalar fields on the entity.
- They may be edited independently by different users (e.g. admin reassigns service owner while sales owner edits company data).
- They benefit from immediate persistence and simpler conflict handling (no merge with CrudForm dirty state).

#### API

```
GET    /api/customers/{companies|people}/{id}/roles
POST   /api/customers/{companies|people}/{id}/roles     { roleType, userId }
PUT    /api/customers/{companies|people}/{id}/roles/{roleId}  { userId }
DELETE /api/customers/{companies|people}/{id}/roles/{roleId}
```

Role types loaded from dictionary: `GET /api/dictionaries?kind=customer-role-types`

#### Behavior

| Rule | Detail |
| ---- | ------ |
| Save | Independent from CrudForm — roles API is separate CRUD. Same pattern as tags in SPEC-046. |
| User search | Staff user lookup with search: `GET /api/staff?search=query` |
| Default roles | Seeded from dictionary: `sales_owner`, `service_owner`, `account_manager`. Tenant can add custom role types via dictionary management. |
| Display priority | Roles section positioned high in Zone 1 (after "details" group) — business requirement: "must be visible quickly". |

#### CrudForm Integration

```tsx
// In companyEditGroups:
{
  id: 'roles',
  title: t('customers.company.roles.title'),
  column: 1,
  component: ({ values }) => (
    <RolesSection
      entityType="company"
      entityId={values.id as string}
    />
  ),
}
```

#### Files

| File | Action |
| ---- | ------ |
| `packages/core/src/modules/customers/components/detail/RolesSection.tsx` | New |
| `packages/core/src/modules/customers/components/detail/RoleAssignmentRow.tsx` | New |
| `packages/core/src/modules/customers/api/roles/route.ts` | New — CRUD API |
| `packages/core/src/modules/customers/entities/CustomerEntityRole.ts` | New — MikroORM entity |
| Migration: `add_customer_entity_roles_table` | New |
| `formConfig.tsx` (company + person) | Modified — add roles group |
| `packages/core/src/modules/customers/acl.ts` | Modified — add `customers.roles.manage` permission |

---

### Enhancement 4: Deal Stage Progress Bar

#### Architecture

Extends the `contentHeader` of SPEC-047 sales document page. Adds a visual pipeline stage bar above the CrudForm.

```
┌──────────────────────────────────────────────────────────────┐
│ contentHeader: DocumentSummaryCard                           │
│                                                              │
│  Order #12345                                    [⚙] [⋯]   │
│  Customer: Acme Corp    Status: In Progress                  │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ STAGE PROGRESS BAR                                      │ │
│  │                                                         │ │
│  │  [Qualification]──[Proposal]──[Negotiation]──[Closing]  │ │
│  │       ✓              ✓            ●              ○      │ │
│  │                                                         │ │
│  │  ✓ = completed   ● = current   ○ = upcoming            │ │
│  │                                                         │ │
│  │  Click any stage to advance/move deal                   │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  [Won ✓]  [Lost ✕]                                          │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

#### Behavior

| Rule | Detail |
| ---- | ------ |
| Data source | Pipeline stages from SPEC-028: `GET /api/sales/pipelines/{pipelineId}/stages` |
| Current stage | Mapped from `document.statusEntryId` → pipeline stage |
| Click to advance | Click a future stage → confirm dialog → `PATCH /api/sales/{orders|quotes}/{id}` with new `statusEntryId`. If stage has required fields, dialog shows them before confirming. |
| Click past stage | Click a previous stage → warning: "Move deal back to [stage]?" → confirm → PATCH |
| Visual | Stages always labeled with text (not just color). Completed = filled + checkmark. Current = highlighted + dot. Upcoming = outline. |
| Accessibility | `role="progressbar"`, `aria-valuenow`, `aria-valuetext`. Color is never sole indicator — icons + text always present. |
| Won/Lost buttons | Below the progress bar. Trigger `DealClosureDialog`. |

#### Stage transition rules

- Stage transitions are subject to existing sales document edit permissions (`sales.edit`).
- Forward and backward transitions are allowed in v1 unless restricted by pipeline configuration (SPEC-028).
- `won` and `lost` are terminal states from a reporting perspective, but may be reopened by authorized users if the underlying sales domain permits it. **This is an open decision — see Decisions to Confirm.**
- If reopen is not supported by the existing domain model, won/lost must be treated as non-reversible in v1 and the progress bar must visually lock.

#### Won/Lost Flow (DealClosureDialog)

```
User clicks [Won ✓]:
  → Confirmation dialog: "Mark as won?"
  → On confirm: PATCH status to won stage
  → Success animation (confetti/green flash — subtle)

User clicks [Lost ✕]:
  → Dialog with:
    - Loss reason (required, dictionary select: lost_to_competitor, no_budget, 
      no_decision, timing, other)
    - Loss notes (optional textarea)
  → On confirm: PATCH status to lost stage + store loss reason
  → Redirect to pipeline view or stay on card
```

#### API

Stage change uses existing sales API:

```
PATCH /api/sales/{orders|quotes}/{id}
{
  "statusEntryId": "uuid-of-target-stage",
  "closureOutcome": "won" | "lost",     // only on closure
  "lossReasonId": "uuid",                // only when lost
  "lossNotes": "They went with SAP"      // optional
}
```

Loss reasons from dictionary: `GET /api/dictionaries?kind=deal-loss-reasons`

#### Domain effects

This spec defines the card-level closure interaction only. It does not define downstream automations, notifications, forecast updates, or reporting semantics beyond storing:
- `closure_outcome` (won/lost)
- `loss_reason_id` (dictionary reference)
- `loss_notes` (free text)

Any additional side effects (e.g. auto-create project on won, notify manager on lost, update forecast) remain governed by existing sales domain rules, UMES event subscribers, or future specs.

#### Files

| File | Action |
| ---- | ------ |
| `packages/core/src/modules/sales/components/documents/StageProgressBar.tsx` | New |
| `packages/core/src/modules/sales/components/documents/DealClosureDialog.tsx` | New |
| `packages/core/src/modules/sales/components/documents/DocumentSummaryCard.tsx` | Modified — embed StageProgressBar + Won/Lost buttons |
| `packages/core/src/modules/sales/api/documents/route.ts` | Modified — handle `closureOutcome`, `lossReasonId`, `lossNotes` in PATCH |
| Migration: `add_closure_fields_to_sales_documents` | New — adds `closure_outcome`, `loss_reason_id`, `loss_notes` columns |

---

### Enhancement 5: Activity Timeline Filtering

#### Architecture

Extends the Zone 2 Activities tab with filter bar and planned/overdue section.

```
┌──────────────────────────────────────────────────────────┐
│ Zone 2: Activities tab                                    │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ PLANNED ACTIVITIES (pinned section, above history)   │ │
│  │                                                      │ │
│  │  🔴 Overdue: Call Jan Kowalski (was: Apr 2)         │ │
│  │  🟢 Upcoming: Meeting with Acme (Apr 9)             │ │
│  │  🟢 Upcoming: Send proposal (Apr 11)                │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ FILTER BAR                                           │ │
│  │  [📞] [✉️] [🤝] [📝] [All]     📅 Date range       │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ HISTORY TIMELINE                                     │ │
│  │                                                      │ │
│  │  Apr 5 ─── ✉️ Sent follow-up email                  │ │
│  │  Apr 3 ─── 📞 Discovery call (30 min)               │ │
│  │  Apr 1 ─── 📝 Created company record                │ │
│  │  Mar 28 ── 🤝 Intro meeting at conference           │ │
│  │                                                      │ │
│  │  ──── 2025 ──── (year divider, click to jump)       │ │
│  │  Dec 15 ── 📞 Initial contact                       │ │
│  └─────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

#### Behavior

| Rule | Detail |
| ---- | ------ |
| Planned section | Shows only activities with `scheduledAt` in the future or overdue (`scheduledAt` in the past, not marked done). Always visible above history. |
| Overdue indicator | Red dot + "Overdue" label for activities past `scheduledAt`. Color is NOT sole indicator — text label always present (WCAG). |
| Type filter | Toggle buttons for each activity type. Multiple can be active (OR logic). "All" resets to unfiltered. |
| Date range | Optional date range picker. Filters history timeline only (not planned section). |
| Year dividers | When timeline spans multiple years, show year dividers. Click to scroll-jump (inspired by Tilio). |
| Pin/unpin | Any history entry can be pinned (📌 icon). Pinned items appear in a "Pinned" section above timeline. Unpin removes from section. |
| Persistence | Filter state in URL params: `?activityType=call,email&from=2026-01-01`. Enables shareable filtered views. |

#### Planned vs history contract

Planned/overdue items and historical items are two distinct presentation buckets over the same interaction model (SPEC-046b). The same interaction record must never appear simultaneously in both the planned section and the history section. An interaction transitions from planned to history when it is marked as completed or its `scheduledAt` passes and it is marked done.

#### Filter state source of truth

The URL query string is the source of truth for timeline filter state. On initial render:
1. Parse filters from URL if present.
2. Otherwise use the default unfiltered state.

Local component state should mirror the URL, not replace it. Changing a filter updates both the URL and the component state atomically.

#### API

Extends existing interactions endpoint with filter params:

```
GET /api/customers/interactions?entityType=company&entityId=uuid
    &type=call,email            // optional, comma-separated
    &from=2026-01-01            // optional
    &to=2026-04-06              // optional
    &status=planned|completed   // optional
    &pinned=true                // optional
    &page=1&pageSize=20
```

Pin/unpin:

```
PATCH /api/customers/interactions/{id}
{ "pinned": true }
```

#### Files

| File | Action |
| ---- | ------ |
| `packages/core/src/modules/customers/components/detail/ActivityTimelineFilters.tsx` | New |
| `packages/core/src/modules/customers/components/detail/PlannedActivitiesSection.tsx` | New |
| `packages/core/src/modules/customers/components/detail/ActivityTimeline.tsx` | New — replaces flat list with filtered timeline + year dividers |
| `packages/core/src/modules/customers/components/detail/ActivitiesSection.tsx` | Modified — compose new sub-components |
| `packages/core/src/modules/customers/api/interactions/route.ts` | Modified — add filter params, pin field |
| Migration: `add_pinned_to_interactions` | New — adds `pinned boolean default false` |

---

## UMES Integration (New Spots)

| Spot | Location | Purpose |
| ---- | -------- | ------- |
| `detail:customers.company:activity-composer` | Between Zone 1 and Zone 2 | Inject custom activity types or widgets alongside the 4 default types |
| `detail:customers.company:roles` | Roles section | Inject custom role types or role-related widgets |
| `detail:sales.order:stage-bar` | Stage progress bar area | Inject badges, alerts, or widgets alongside the stage bar |
| `detail:sales.order:closure` | Closure dialog | Inject custom closure fields (e.g., competitor name on loss) |

#### UMES extension boundary

Injected widgets in these spots may extend presentation and collect auxiliary data, but must not silently override core save semantics unless explicitly supported by the host contract.

In particular:
- `activity-composer` extensions must not dirty CrudForm.
- `roles` extensions must not bypass role permissions (`customers.roles.manage`).
- `stage-bar` and `closure` extensions must not perform undocumented stage mutations.
- All injected widgets handle their own persistence (triad pattern from SPEC-041 Phase G).

---

## Implementation Phases

| Phase | Enhancements | Estimate | Dependencies |
| ----- | ------------ | -------- | ------------ |
| **Phase 1 (hackathon target)** | Collapsible groups + Collapsible Zone 1 panel + Inline activity composer | 4–5 days | SPEC-046 implemented, SPEC-046b interactions API |
| **Phase 2** | Stage progress bar + Won/Lost flow | 3–4 days | SPEC-047 implemented, SPEC-028 pipelines |
| **Phase 3** | Multi-role assignment | 2–3 days | New migration, dictionary seeding |
| **Phase 4** | Activity timeline filtering + pinning | 2–3 days | SPEC-046b interactions API extended |
| **Phase 5** | Changelog tab + audit-log projections (see Rev 4) | 2–3 days | `action_logs` column additions |
| **Phase 6** | Dashboard tab + widgets (Rev 5 — added during implementation) | 3–4 days | SPEC-028 pipelines, SPEC-046b interactions |
| **Phase 7** | Per-user Labels + Dictionary Kind Settings + reorder/default (Rev 5) | 3–4 days | Dictionary module migration |
| **Phase 8** | AI Action Chips + Decision Makers Footer + Mini Week Calendar + Activity Log tab (Rev 5) | 2–3 days | None |

---

## Additional UX Iterations (Rev 5 — Added During Implementation)

Between the original 2026-04-06 draft and the branch landing on 2026-04-19, the UX designer delivered further iterations that shipped alongside Phases 1–5 on the same branch. This section catalogs those additions so the spec reflects the full scope of the `feat/crm-details-screens` branch.

Each sub-section below follows the same shape as Enhancements 1–5 (Architecture, Behavior, Files) but at a higher level — implementation detail lives in the code, this serves as the architectural record.

### Enhancement 6 — Company Dashboard Tab

#### Architecture

New Zone 2 tab on the company detail page: a widget grid that answers "what do I need to know about this account right now?" without having to click through other tabs. Composed of independent widgets that each resolve their own data.

```
┌── Zone 2: [Dashboard] [Details] [People] [Deals] [Activities] ──┐
│                                                                  │
│  ┌─ Active Deal ────────┐  ┌─ Relationship Health ────────────┐ │
│  │ Order #12345         │  │ Score: 78/100                    │ │
│  │ €45,000 · Negotiation│  │ Last contact: 3 days ago         │ │
│  │ Close est.: 2026-05  │  │ Overdue tasks: 1                 │ │
│  └──────────────────────┘  └──────────────────────────────────┘ │
│                                                                  │
│  ┌─ Next Step ──────────┐  ┌─ Open Tasks (3) ─────────────────┐ │
│  │ 📞 Follow-up call    │  │ 🔴 Send proposal (overdue)       │ │
│  │ Tomorrow, 14:00      │  │ 🟢 Schedule demo                 │ │
│  │ [Reschedule]         │  │ 🟢 Confirm Q2 renewal            │ │
│  └──────────────────────┘  └──────────────────────────────────┘ │
│                                                                  │
│  ┌─ Upcoming Meetings ──────────────────────────────────────────┐│
│  │ 🤝 Apr 22 · 10:00 · Strategy sync with Jan Kowalski          ││
│  │ 🤝 May 03 · 14:00 · Q2 review                                ││
│  └──────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌─ Recent Activity (timeline preview, 5 most recent) ──────────┐│
│  │ …                                                            ││
│  └──────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
```

#### Widgets

| Widget | Data source | Notes |
| ------ | ----------- | ----- |
| `ActiveDealWidget` | `/api/customers/companies/{id}/deals?status=open&limit=1` + pipeline lookup | Shows the single highest-value open deal; empty state when none |
| `RelationshipHealthWidget` | `healthScoreUtils.computeHealthScore(...)` over interactions, deals, last-contact | Pure-client computation over already-loaded company/interaction payload |
| `NextStepCard` | `/api/customers/interactions?entityType=company&entityId={id}&scheduledAt[gt]=now&limit=1` | Surfaces the nearest scheduled activity; "Reschedule" opens `ScheduleActivityDialog` |
| `OpenTasksWidget` | `/api/customers/todos?entityType=company&entityId={id}&status=open` | Inline quick-complete + overdue highlight |
| `UpcomingMeetingsWidget` | `/api/customers/interactions?entityType=company&entityId={id}&type=meeting&scheduledAt[gt]=now` | Sorted ascending by `scheduledAt` |
| `RecentActivityWidget` | Shared `PlannedActivitiesSection` / `ActivityHistorySection` in compact mode | Deep link → full Activities tab |
| `CompanyCard` | Summary of company scalars (status, size, industry) | Shared with `PersonDetailTabs` for consistency |

Widgets are dashboard-independent (no shared store): each widget owns its own loading/error/empty state and participates in the standard DOM event bridge for cross-widget refreshes (interaction created → refresh `NextStepCard`, `UpcomingMeetingsWidget`, `RecentActivityWidget`).

#### Behavior

| Rule | Detail |
| ---- | ------ |
| Default tab | Dashboard is NOT default on first load — Details tab remains default to preserve SPEC-046 muscle memory. User can pin Dashboard as default via a per-user preference in a later iteration. |
| Empty state | Each widget shows its own empty state (`<EmptyState>` primitive) with a CTA to create the relevant entity. |
| Refresh | Widgets subscribe to `customers.*.created/updated/deleted` via DOM event bridge. Only affected widgets refresh. |
| Layout | CSS Grid, 2 columns on `md+`, single column below `md`. Widgets are roughly equal height; tall widgets (`UpcomingMeetingsWidget`, `RecentActivityWidget`) span full width. |

#### Files

| File | Action |
| ---- | ------ |
| `packages/core/src/modules/customers/components/detail/CompanyDashboardTab.tsx` | New |
| `packages/core/src/modules/customers/components/detail/dashboard/ActiveDealWidget.tsx` | New |
| `packages/core/src/modules/customers/components/detail/dashboard/RelationshipHealthWidget.tsx` | New |
| `packages/core/src/modules/customers/components/detail/dashboard/OpenTasksWidget.tsx` | New |
| `packages/core/src/modules/customers/components/detail/dashboard/UpcomingMeetingsWidget.tsx` | New |
| `packages/core/src/modules/customers/components/detail/dashboard/RecentActivityWidget.tsx` | New |
| `packages/core/src/modules/customers/components/detail/dashboard/helpers.ts` | New — shared widget utilities |
| `packages/core/src/modules/customers/components/detail/ActiveDealCard.tsx` | New — card presentation shared between widget + list views |
| `packages/core/src/modules/customers/components/detail/NextStepCard.tsx` | New |
| `packages/core/src/modules/customers/components/detail/CompanyCard.tsx` | New |
| `packages/core/src/modules/customers/components/detail/CompanyKpiBar.tsx` | New — KPI ribbon atop the company page |
| `packages/core/src/modules/customers/components/detail/healthScoreUtils.ts` | New — pure computation |
| `packages/core/src/modules/customers/components/detail/pipelineStageUtils.ts` | New — pure helpers for stage math |

---

### Enhancement 7 — AI Action Chips on Activities

#### Architecture

Each `ActivityCard` exposes a row of contextual AI action chips (e.g., "Draft reply", "Summarize", "Extract next step"). The chip set is data-driven from `aiActionCatalog.ts` so adding a new action is one catalog entry — no UI edits.

#### Behavior

| Rule | Detail |
| ---- | ------ |
| Chip visibility | Each catalog entry declares `appliesTo` (activity types) and optional feature-gate. |
| Invocation | Click → calls existing MCP tool (`@open-mercato/ai-assistant`) with a scoped prompt; result streams back into the activity inline. |
| Permissions | AI actions require `customers.interactions.manage` plus any additional feature declared in the catalog entry. |
| Non-blocking | Errors surface via `flash('…', 'error')`; activity content is never mutated without explicit user confirmation. |

#### Files

| File | Action |
| ---- | ------ |
| `packages/core/src/modules/customers/components/detail/aiActionCatalog.ts` | New — declarative catalog |
| `packages/core/src/modules/customers/components/detail/AiActionChips.tsx` | New — chip row |
| `packages/core/src/modules/customers/components/detail/ActivityAiActions.tsx` | New — execution wrapper |
| `packages/core/src/modules/customers/components/detail/ActivityCard.tsx` | New — canonical activity card composition |
| `packages/core/src/modules/customers/components/detail/ActivityLogTab.tsx` | New — Activities tab shell |
| `packages/core/src/modules/customers/components/detail/ActivityHistorySection.tsx` | New — grouped history list |

---

### Enhancement 8 — Per-User Customer Labels (free-pool)

#### Architecture

Distinct from the shared "tags" / dictionary-driven labels used across the tenant, this enhancement introduces **per-user** free-pool labels that let each salesperson annotate customers privately. Conceptually similar to Gmail labels: owned by a user, visible only to that user, scoped to a tenant+org.

#### Data Model

Two new tables:

`customer_labels`

| Column | Type | Notes |
| ------ | ---- | ----- |
| `id` | uuid | PK |
| `organization_id` | uuid | Scoped per org |
| `tenant_id` | uuid | Multi-tenant |
| `user_id` | uuid | FK → owning staff user |
| `slug` | text | URL-safe identifier, unique per (user, tenant, org) |
| `label` | text | Display label |
| `created_at`, `updated_at` | timestamptz | |

**Unique constraint:** `(user_id, tenant_id, organization_id, slug)`.

`customer_label_assignments`

| Column | Type | Notes |
| ------ | ---- | ----- |
| `id` | uuid | PK |
| `organization_id` | uuid | |
| `tenant_id` | uuid | |
| `user_id` | uuid | Must match `customer_labels.user_id` — labels are private |
| `label_id` | uuid | FK → `customer_labels.id` |
| `entity_id` | uuid | FK → `customer_entities.id` |
| `created_at` | timestamptz | |

**Unique constraint:** `(label_id, entity_id)`.

#### API

```
GET    /api/customers/labels
POST   /api/customers/labels                     { slug, label }
DELETE /api/customers/labels/{id}
POST   /api/customers/labels/assign              { labelId, entityId, organizationId? }
POST   /api/customers/labels/unassign            { labelId, entityId }
```

Routes declare only `requireAuth: true`; the runtime check resolves the target entity and calls the appropriate per-kind feature (`customers.people.manage` or `customers.companies.manage`) scoped to the entity's org — see root "Migration & Backward Compatibility → Label feature-gate semantics (H10)".

All writes flow through commands: `customers.labels.create`, `customers.labels.delete`, `customers.labels.assign`, `customers.labels.unassign`. Each emits `customers.label.{created,updated,deleted}` or `customers.label_assignment.{created,updated,deleted}`.

#### UI

| Component | Purpose |
| --------- | ------- |
| `EntityTagsDialog` | Generic tag/label manage dialog (composes tags + labels) |
| `CompanyTagsDialog` | Specialization for companies |
| `PersonTagsDialog` | Specialization for persons |
| `ManageTagsDialog` | Global tag admin (in Rev 2 spec) |

#### Files

| File | Action |
| ---- | ------ |
| `packages/core/src/modules/customers/data/entities.ts` | +`CustomerLabel`, `CustomerLabelAssignment` |
| `packages/core/src/modules/customers/data/validators.ts` | +`labelCreateSchema`, `labelAssignmentSchema`, … |
| `packages/core/src/modules/customers/commands/labels.ts` | New — commands with undo + events |
| `packages/core/src/modules/customers/api/labels/route.ts` | New |
| `packages/core/src/modules/customers/api/labels/assign/route.ts` | New |
| `packages/core/src/modules/customers/api/labels/unassign/route.ts` | New |
| `packages/core/src/modules/customers/components/detail/{EntityTagsDialog,CompanyTagsDialog,PersonTagsDialog}.tsx` | New |

---

### Enhancement 9 — Dictionary Kind Settings (tenant-scoped CRM config)

#### Architecture

CRM dictionaries (status, loss reason, role type, etc.) now support per-tenant+org configuration via a new table `customer_dictionary_kind_settings`. Each kind can be configured with:

- `selection_mode` — `'single'` or `'multi'` — whether the dictionary is single-select or multi-select in forms that consume it.
- `visible_in_tags` — whether dictionary entries appear in the unified tags surface (search, filter, assign).
- `sort_order` — display priority within the CRM settings UI.

The settings are surfaced in a new admin page (Backend → CRM → Configuration) composed of `CustomersConfigurationSections` and the shared `DictionarySettings` panel.

#### Data Model

`customer_dictionary_kind_settings`

| Column | Type | Notes |
| ------ | ---- | ----- |
| `id` | uuid | PK |
| `organization_id` | uuid | Scoped per org |
| `tenant_id` | uuid | Multi-tenant |
| `kind` | text | Matches a dictionary kind (e.g. `customer_status`) |
| `selection_mode` | text | `'single'` (default) or `'multi'` |
| `visible_in_tags` | boolean | Default `true` |
| `sort_order` | int | Default `0` |
| `created_at`, `updated_at` | timestamptz | |

**Unique:** `(organization_id, tenant_id, kind)`.

#### API

```
GET    /api/customers/dictionaries/kind-settings
PUT    /api/customers/dictionaries/kind-settings     { kind, selectionMode?, visibleInTags?, sortOrder? }
```

Writes flow through `customers.dictionaryKindSettings.upsert` command.

#### Files

| File | Action |
| ---- | ------ |
| `packages/core/src/modules/customers/data/entities.ts` | +`CustomerDictionaryKindSetting` |
| `packages/core/src/modules/customers/commands/dictionaryKindSettings.ts` | New |
| `packages/core/src/modules/customers/api/dictionaries/kind-settings/route.ts` | New |
| `packages/core/src/modules/customers/components/DictionarySettings.tsx` | New — settings UI panel |
| `packages/core/src/modules/customers/components/CustomersConfigurationSections.tsx` | New — admin page composition |
| `packages/core/src/modules/customers/backend/config/customers/page.tsx` | New — `/backend/config/customers` page |

---

### Enhancement 10 — Dictionary Entry Reorder + Set-Default

#### Architecture

The shared `dictionaries` module gains two capabilities needed for CRM UX:

1. **Manual ordering** — drag, chevron arrows (see linking/mobile spec Enhancement 4), or API.
2. **Default entry** — each dictionary may designate exactly one entry as its "default" (used when creating a new record, e.g. a new company defaults to status = "active").

#### Schema changes

Migration `Migration20260410171544.ts` on `dictionary_entries`:

- `ADD COLUMN position int NOT NULL DEFAULT 0` — manual ordering
- `ADD COLUMN is_default boolean NOT NULL DEFAULT false`
- Backfill `position` from `row_number() OVER (PARTITION BY dictionary_id, organization_id, tenant_id ORDER BY lower(label), lower(value), id) - 1` so existing entries get a deterministic initial order.
- Partial unique index: `CREATE UNIQUE INDEX dictionary_entries_one_default_per_dict ON dictionary_entries (dictionary_id, organization_id, tenant_id) WHERE is_default = true` — enforces at most one default per dictionary per tenant+org.
- Seeded `customers.status` dictionary's `active` entry is marked default, **only when no other entry in that dictionary is already marked default** (idempotent guard so tenants that customize defaults via UI after deploying this migration are not overridden on replay).

#### API

```
POST /api/dictionaries/{dictionaryId}/entries/reorder       { entries: [{ id, position }] }
POST /api/dictionaries/{dictionaryId}/entries/set-default   { entryId }
```

Both routes are command-backed: `dictionaries.entries.reorder` and `dictionaries.entries.set_default`. Each is wrapped in `withAtomicFlush({ transaction: true })` so either the whole reorder commits or nothing does.

#### Events

| ID | Meaning |
| -- | ------- |
| `dictionaries.entry.created` | New entry persisted |
| `dictionaries.entry.updated` | Entry scalar, position, or default flag changed |
| `dictionaries.entry.deleted` | Soft-deleted |

The `dictionaries` module gains its own `events.ts` declaring these via `createModuleEvents({ moduleId: 'dictionaries', … })`.

#### Files

| File | Action |
| ---- | ------ |
| `packages/core/src/modules/dictionaries/migrations/Migration20260410171544.ts` | New |
| `packages/core/src/modules/dictionaries/data/entities.ts` | +`position`, +`isDefault` |
| `packages/core/src/modules/dictionaries/data/validators.ts` | +`reorderSchema`, +`setDefaultSchema` |
| `packages/core/src/modules/dictionaries/events.ts` | New |
| `packages/core/src/modules/dictionaries/commands/entry-operations.ts` | New — `reorder`, `set_default` commands |
| `packages/core/src/modules/dictionaries/api/[dictionaryId]/entries/reorder/route.ts` | New |
| `packages/core/src/modules/dictionaries/api/[dictionaryId]/entries/set-default/route.ts` | New |
| `packages/core/src/modules/dictionaries/components/DictionaryTable.tsx` | Modified — render drag handles + default toggle |

---

### Enhancement 11 — Company Billing Extension (extension entity)

#### Architecture

Per the "never mutate another module's entity" rule, the CRM company sub-record for billing is implemented as an **extension entity** with a 1:1 FK to `customer_entities`.

#### Data Model

`customer_company_billing`

| Column | Type | Notes |
| ------ | ---- | ----- |
| `id` | uuid | PK |
| `organization_id` | uuid | |
| `tenant_id` | uuid | |
| `entity_id` | uuid | FK → `customer_entities.id`; **unique** (1:1 per company) |
| `bank_name` | text | Nullable |
| `bank_account_masked` | text | Nullable; stored masked (e.g., `****1234`) |
| `payment_terms` | text | Nullable; dictionary-backed in UI |
| `preferred_currency` | text | Nullable; ISO 4217 code |
| `created_at`, `updated_at` | timestamptz | |

Rendered inside the company CrudForm as a dedicated "Billing" group (collapsible per Enhancement 1). Managed via the existing company update command and response-enricher pattern (no new command).

#### Files

| File | Action |
| ---- | ------ |
| `packages/core/src/modules/customers/data/entities.ts` | +`CustomerCompanyBilling` |
| `packages/core/src/modules/customers/data/extensions.ts` | Declare extension link |
| `packages/core/src/modules/customers/commands/people.ts` | Updated update flow to persist billing scalars transactionally |
| `packages/core/src/modules/customers/components/formConfig.tsx` | Add billing group to the company form |

---

### Enhancement 12 — Person-Company Roles (junction)

#### Architecture

Distinct from the SPEC-072 "entity role" concept (which assigns a _staff user_ to a role on a company/person), this junction answers: "What role does person X play on company Y?" (e.g., CFO of Acme, Procurement lead at Globex). A single person can hold many such role records across different companies, and vice versa.

#### Data Model

`customer_person_company_roles`

| Column | Type | Notes |
| ------ | ---- | ----- |
| `id` | uuid | PK |
| `organization_id` | uuid | |
| `tenant_id` | uuid | |
| `person_entity_id` | uuid | FK → `customer_entities.id` (kind=person) |
| `company_entity_id` | uuid | FK → `customer_entities.id` (kind=company) |
| `role_value` | text | Dictionary-driven (`procurement`, `cfo`, `account_manager`, …) |
| `created_at` | timestamptz | |

**Unique:** `(person_entity_id, company_entity_id, role_value)` — one copy of each role per pair.

#### API

Exposed through the existing person-company link endpoints — roles are set as part of the link payload and rendered inside `PersonCompaniesSection` / `CompanyPeopleSection`.

#### Files

| File | Action |
| ---- | ------ |
| `packages/core/src/modules/customers/data/entities.ts` | +`CustomerPersonCompanyRole` |
| `packages/core/src/modules/customers/lib/customerRoleTypes.ts` | New — default role type seeds |
| `packages/core/src/modules/customers/lib/roleTypeUsage.ts` | New — checks role usage before deleting a role type from the dictionary |
| `packages/core/src/modules/customers/commands/personCompanyLinks.ts` | Accepts and syncs role collection |
| `packages/core/src/modules/customers/components/detail/DecisionMakersFooter.tsx` | New — renders roles as a compact footer on the company card |

---

### Enhancement 13 — Deal Stage Transitions Audit

#### Architecture

Every time a deal's pipeline stage changes, an immutable record is written to `customer_deal_stage_transitions`. This gives the Changelog tab (Phase 5) and downstream reporting a precise history independent of the generic `action_logs` projection.

#### Data Model

`customer_deal_stage_transitions`

| Column | Type | Notes |
| ------ | ---- | ----- |
| `id` | uuid | PK |
| `organization_id` | uuid | |
| `tenant_id` | uuid | |
| `deal_id` | uuid | FK → `customer_deals.id` |
| `from_stage_id` | uuid | Nullable (first-entry into pipeline) |
| `to_stage_id` | uuid | Not null |
| `actor_user_id` | uuid | Nullable |
| `occurred_at` | timestamptz | |
| `closure_outcome` | text | Nullable: `won`, `lost`, or null |
| `loss_reason_id` | uuid | Nullable |

Populated inside `customers.deals.update` command whenever `pipelineStageId` changes, using `withAtomicFlush({ transaction: true })` so deal scalar + transition row commit atomically.

#### Consumer

`packages/core/src/modules/customers/lib/dealStageTransitionTable.ts` exposes a helper used by `PipelineStepper` and the Changelog tab to render transition history with human-readable stage labels.

---

### Enhancement 14 — Decision Makers Footer

Compact footer on the company detail card listing the linked people with their `role_value` (see Enhancement 12). Renders as a horizontal strip with avatars + role labels; click → navigates to the person's card. Primarily read-only; the actual edit affordance lives in the Zone 2 People tab.

Files: `packages/core/src/modules/customers/components/detail/DecisionMakersFooter.tsx`.

---

### Enhancement 15 — Mini Week Calendar (Planned Activities)

A compact horizontal 7-day strip injected above the Planned Activities section (Enhancement 5). Each day cell shows activity dots color-coded by type; click a day to filter the Planned list to that day.

Files: `packages/core/src/modules/customers/components/detail/MiniWeekCalendar.tsx`.

Key behavior:

- Keyboard: `ArrowLeft` / `ArrowRight` move the focused day; `Enter` / `Space` selects.
- Respects `prefers-reduced-motion` for week-swap transitions.
- No new API — consumes the same planned-activities payload used by `PlannedActivitiesSection`.

---

### Enhancement 16 — Coming Soon Placeholder

Shared `<ComingSoonPlaceholder>` component rendered in tab slots where the Phase 6–8 work lands incrementally (e.g., a company tab marked "Reports" that's scaffolded but not yet implemented). Gives the UX a consistent empty state instead of a blank tab during rollout.

Files: `packages/core/src/modules/customers/components/detail/ComingSoonPlaceholder.tsx`.

---

## Cross-cutting — Enhancements 6–16

- **Events** — all new commands declare and emit events (`customers.label.*`, `customers.label_assignment.*`, `customers.person_company_link.*`, `dictionaries.entry.*`). Already enumerated in the "Migration & Backward Compatibility" table.
- **Tenant isolation** — every table has `(tenant_id, organization_id)` columns and every query filters by them.
- **Undo/Redo** — every command (labels, dictionary settings, reorder, set-default, person-company links, entity roles) captures a before/after snapshot and supports undo per the Command pattern.
- **i18n** — all user-facing strings routed through `useT()` / `resolveTranslations()`. New keys under `customers.dashboard.*`, `customers.ai.*`, `customers.labels.*`, `customers.config.dictionaries.*`, `customers.decisionMakers.*`, `customers.calendar.*`, `customers.comingSoon.*` are present in all four locale files.
- **A11y** — dashboard widgets, AI action chips, decision makers footer, mini week calendar and coming soon placeholder all satisfy the WCAG checklist declared at the top of this spec (labeled landmarks, keyboard nav, 44px touch targets, `prefers-reduced-motion`, no color-only indicators).

---

## Integration Tests

### TC-UX-001: Collapsible Groups

```
Navigate: /backend/customers/companies-v2/{id}

Verify all groups expanded by default
Click collapse on "Profile" group:
  - Verify group content hidden
  - Verify group header still visible with "►"
  
Reload page:
  - Verify "Profile" still collapsed (localStorage persistence)

Add validation error to collapsed group field:
  - Clear required displayName
  - Click Save
  - Verify collapsed group auto-expands
  - Verify error badge shows on group header
```

### TC-UX-001b: Collapsible Zone 1 Panel

```
Navigate: /backend/customers/companies-v2/{id}

Verify Zone 1 (CrudForm) and Zone 2 (tabs) rendered side by side
Verify collapse arrow [◄] visible at right edge of Zone 1

Click [◄]:
  - Verify Zone 1 collapses to narrow strip (~48px)
  - Verify entity name visible in collapsed strip
  - Verify Zone 2 expands to full width
  - Verify expand arrow [►] visible

Click [►]:
  - Verify Zone 1 expands back to original width
  - Verify Zone 2 returns to original width

Reload page:
  - Verify collapsed state persisted (localStorage)

Resize to mobile (<768px):
  - Verify layout is stacked vertically (no collapse arrow)
```

### TC-UX-002: Inline Activity Composer

```
Navigate: /backend/customers/companies-v2/{id}

Verify 4 activity type icons visible between Zone 1 and Zone 2
Click [📞 Call]:
  - Verify composer expands inline (no modal)
  - Verify type pre-selected as "Call"
  - Fill description: "Discussed renewal"
  - Click [Save activity]
  - Verify toast confirmation
  - Verify composer collapses back to icon row
  
Navigate to Activities tab:
  - Verify new call activity appears at top of timeline

Verify CrudForm is NOT dirty after activity save
```

### TC-UX-003: Multi-Role Assignment

```
Navigate: /backend/customers/companies-v2/{id}

Verify Roles section visible in Zone 1
Click [+ Add role]:
  - Select role type: "Sales Owner"
  - Search and select user: "Jan Kowalski"
  - Verify role appears in section

Add second role: "Service Owner" → "Anna Nowak"
Verify both roles displayed

Click ✕ on "Sales Owner":
  - Verify removal confirmation
  - Confirm → verify role removed

Reload page:
  - Verify "Service Owner: Anna Nowak" persisted
```

### TC-UX-004: Stage Progress Bar

```
Navigate: /backend/sales/documents-v2/{id}?kind=order

Verify stage bar visible in contentHeader
Verify current stage highlighted with ● indicator
Verify all stages labeled with text

Click next stage:
  - Verify confirmation dialog
  - Confirm
  - Verify stage bar updates (previous → ✓, clicked → ●)

Click [Lost ✕]:
  - Verify closure dialog with loss reason select
  - Select reason: "No budget"
  - Add note: "Will revisit in Q3"
  - Confirm
  - Verify deal marked as lost
  - Verify stage bar shows "Lost" state
```

### TC-UX-005: Activity Timeline Filtering

```
Navigate: /backend/customers/companies-v2/{id}
Click Activities tab

Verify planned section shows upcoming/overdue activities
Verify overdue items show red indicator AND "Overdue" text label

Click [📞] filter:
  - Verify only call activities shown
  - Verify filter state reflected in URL params

Click [✉️] filter (add to selection):
  - Verify calls + emails shown

Click [All]:
  - Verify all types shown, filters reset

Pin an activity:
  - Click 📌 on a history entry
  - Verify entry appears in "Pinned" section
  - Unpin → verify removed from pinned section
```

---

## Risks & Impact Review

| Risk | Severity | Mitigation |
| ---- | -------- | ---------- |
| Collapsible groups break CrudForm validation | High | Fields remain in DOM when collapsed (CSS `display: none` or `height: 0` with `overflow: hidden`, NOT conditional render). Auto-expand on validation error. |
| Zone 1 collapse hides unsaved form changes | Medium | If CrudForm is dirty when user collapses Zone 1, show warning badge on collapsed strip: "Unsaved changes". Expand arrow pulses subtly. Do NOT block collapse — user may intend to review history before saving. |
| Inline activity composer confuses users vs CrudForm save | Medium | Clear visual separation. Composer has its own [Save activity] button, visually distinct from CrudForm [Save]. Toast says "Activity saved" not "Saved". |
| Stage bar click triggers accidental stage change | Medium | Always show confirmation dialog. Undo option in toast for 5 seconds after stage change. |
| Roles migration on large datasets | Low | `customer_entity_roles` is a new table — no existing data migration needed. Seed dictionary only. |
| Activity filtering degrades performance on large histories | Medium | Server-side pagination + filtering. Default page size 20. Index on `(entity_id, type, occurred_at)`. |
| WCAG compliance across new components | High | No color-only indicators. All interactive elements 44x44px touch target. Keyboard navigation for stage bar. `aria-*` attributes on all new components. Test with screen reader before release. |
| Multiple independent save surfaces on one page cause user confusion | Medium | Distinguish CrudForm save vs activity/roles save visually and textually. Use action-specific success toasts ("Aktywność zapisana", "Rola przypisana") — never generic "Saved". Different button colors for CrudForm Save (primary/yellow) vs activity Save (green/secondary). |
| localStorage persistence drift across devices/browsers | Low | Accept as v1 limitation. Collapse/filter preferences are per-device. Document future migration path to user preferences API in Phase 5+. |

---

## Accessibility Checklist

- [ ] Collapsible groups: `aria-expanded`, `aria-controls`, keyboard toggle (Enter/Space)
- [ ] Activity composer: logical focus order when expanded, autofocus first editable field, Escape to close if empty or after confirmation when dirty
- [ ] Activity type icons: `aria-label` on each, keyboard selectable
- [ ] Stage bar: `role="progressbar"`, `aria-valuenow`, `aria-valuetext`, keyboard arrows to navigate stages
- [ ] Overdue indicators: text label always present alongside color
- [ ] All buttons: 44x44px minimum touch target
- [ ] All animations: respect `prefers-reduced-motion`
- [ ] Closure dialog: focus trap, Escape to close, return focus to trigger on close

---

## Alternatives Considered

| Alternative | Why rejected |
| ----------- | ------------ |
| Three-column layout (left/right/top) instead of two-zone | SPEC-046 two-zone is already implemented and working. contentHeader serves as the "top zone". Adding a third column would require rewriting CrudForm layout engine — too much work for marginal gain. |
| Modal for activity creation | Meeting consensus: modals add friction. Inline is faster for CRM power users. All competitive CRMs (Bitrix, Dynamics) are moving away from modals for high-frequency actions. |
| Single "owner" field with multiple selection | Multi-select loses role context. A user assigned to a company could be sales or service — the role label matters for workflows and reporting. |
| Kanban as primary deal view instead of progress bar | Kanban is a list-level view (pipeline overview). Progress bar is a card-level view (single deal context). Both needed — progress bar on card, kanban on list page. Not competing solutions. |

---

## Decisions to Confirm Before Implementation

| # | Decision | Default assumption | Impact if changed |
| - | -------- | ------------------ | ----------------- |
| 1 | Are `won` and `lost` reversible in v1? | Non-reversible — progress bar locks on closure | If reversible: need "Reopen" button, stage bar unlocking logic, audit trail entry |
| 2 | Are backward stage transitions always allowed, or pipeline-configurable? | Always allowed in v1 with confirmation dialog | If configurable: need per-pipeline `allowBackward` flag, UI must read it |
| 3 | Is one assignee per role type a permanent v1 rule? | Yes — unique `(entity_id, role_type)` | If multiple: change to non-unique, UI from select → multi-select, different card layout |
| 4 | Is localStorage-only persistence acceptable for initial rollout? | Yes — collapse/filter state per-device only | If not: need user preferences API endpoint before Phase 1 |
| 5 | Should activity creation use optimistic update or mandatory refetch? | Optimistic prepend if response payload sufficient | If refetch: slower perceived UX, but simpler implementation |
| 6 | Can UMES extensions in stage/closure areas participate in validation, or presentation only? | Presentation only — extensions cannot block stage transitions | If validation: need extension validation contract, async validation pipeline |

---

## Migration & Backward Compatibility

This section satisfies the root `BACKWARD_COMPATIBILITY.md` deprecation-protocol requirement for every PR that touches contract surfaces. The feat/crm-details-screens branch introduces:

### New contract surfaces (purely additive — no deprecation bridge required)

| Surface | Addition | Notes |
| ------- | -------- | ----- |
| Event IDs | `customers.label.{created,updated,deleted}` | Per-user label CRUD events |
| Event IDs | `customers.label_assignment.{created,updated,deleted}` | Emitted by `customers.labels.assign`/`unassign` commands |
| Event IDs | `customers.person_company_link.{created,updated,deleted}` | Emitted by `customers.personCompanyLinks.*` commands |
| Event IDs | `customers.entity_role.{created,updated,deleted}` | Emitted by `customers.entityRoles.*` commands |
| Event IDs | `customers.deal.{won,lost}` (lifecycle) | Emitted on deal-status transition; notification side effect now lives in a subscriber (see H10 below) |
| Event IDs | `dictionaries.entry.{created,updated,deleted}` | New `dictionaries/events.ts` declares the module's own events |
| Commands | `customers.labels.create` | Wraps the previously-inline POST at `/api/customers/labels` with full undo/audit/events/index refresh |
| Commands | `customers.entityRoles.create/update/delete` | Create-command result gained `wasUndelete`, `previousUserId`, `previousDeletedAt` (additive) so undo can restore a prior soft-delete |
| Commands | `customers.personCompanyLinks.create/update/delete` | New |
| Commands | `dictionaries.entries.reorder`, `dictionaries.entries.set_default` | New — atomic `withAtomicFlush` + event emission; replace what were direct route mutations |
| API routes | `/api/customers/labels`, `/api/customers/labels/assign`, `/api/customers/labels/unassign` | New POSTs |
| API routes | `/api/customers/companies/[id]/roles`, `/api/customers/people/[id]/roles` | New CRUD endpoints |
| API routes | `/api/customers/companies/[id]/people`, `/api/customers/deals/[id]/companies`, `/api/customers/deals/[id]/people`, `/api/customers/deals/[id]/stats`, `/api/customers/assignable-staff`, `/api/customers/interactions/conflicts`, `/api/customers/interactions/counts`, `/api/customers/people/[id]/companies/*` | New read endpoints |
| API routes | `/api/customers/dictionaries/kind-settings` | New |
| API routes | `/api/dictionaries/[dictionaryId]/entries/reorder`, `/api/dictionaries/[dictionaryId]/entries/set-default` | New (POST) |
| API routes | `/api/audit_logs/audit-logs/actions/export` | New GET — CSV export of projected action-log entries, gated by `audit_logs.view_self`/`audit_logs.view_tenant` |
| DB tables | `customer_entity_roles`, `customer_person_company_links`, `customer_person_company_roles`, `customer_dictionary_kind_settings`, `customer_labels`, `customer_label_assignments`, `customer_company_billing`, `customer_deal_stage_transitions` | All new; not referenced by existing third-party module code |
| DB columns | `dictionary_entries.position`, `dictionary_entries.is_default` | Added with defaults (`0` / `false`) + partial unique index on `is_default WHERE deleted_at IS NULL` |
| DB columns | `action_logs.action_type`, `action_logs.changed_fields` (text[]), `action_logs.primary_changed_field`, `action_logs.source_key` | All added with `null` defaults; existing rows backfilled by the projection CLI; new indexes are additive |
| ACL features | `customers.roles.view`, `customers.roles.manage` | New; mirrored in `setup.ts` `defaultRoleFeatures` |

No existing event IDs, spot IDs, API URLs, DB columns, DI names, ACL features, import paths, or type fields were removed or renamed. Additive response fields on `companies/[id]` and `people/[id]` (e.g. `counts`, `kpis`, `plannedActivitiesPreview`, `companies[]`, `isPrimary`, `temperature`, `renewalQuarter`, new `deals[].pipelineId`/`pipelineStageId`/`closureOutcome`/`lossReasonId`/`lossNotes`) preserve all pre-existing fields.

### Behavioral contract change — query engine `eq` on joined entities (non-breaking; encryption-aware)

`BasicQueryEngine` (`packages/shared/src/lib/query/engine.ts`) and `HybridQueryEngine` (`packages/core/src/modules/query_index/lib/engine.ts`) now route `eq` filters on joined entities to tokenized search when both (a) `searchEnabled` is set on the query, and (b) the joined entity has search tokens installed. Non-searchable columns or `searchEnabled=false` still lower to exact SQL equality. The change unblocks filtering encrypted joined columns whose ciphertext cannot be compared for equality in SQL. Token match is approximate — callers that need strict equality on an encrypted field should filter on the deterministic `*_hash` column. Documented in `RELEASE_NOTES.md` → "Non-Breaking Changes".

### withAtomicFlush transaction contract fix

`packages/shared/src/lib/commands/flush.ts` switched from `em.transactional(cb)` to explicit `em.begin() → em.commit() / em.rollback()` so the outer `EntityManager` stays bound to the transaction and phase closures that reference the caller's `em` participate correctly. Empty `phases` is now a true no-op (no flush, no transaction). Call sites on this branch were audited; test mocks now include `em.begin/commit/rollback`.

### Label assign/unassign feature-gate semantics (H10 in review)

Prior static metadata (`requireFeatures: ['customers.people.manage']`) mismatched the reality that labels can target both person and company entities. Now the routes declare only `requireAuth: true` at the metadata layer and runtime-check the kind-appropriate feature (`customers.people.manage` for persons, `customers.companies.manage` for companies) against the resolved entity's organization. Callers with both features see no change. Callers with only one feature see the correct 403/allow outcome for the correct entity kind (previously denied legitimate access and/or permitted illegitimate access).

### Deal-closure notification moved to a subscriber

The deals update command previously called `resolveNotificationService(...)` + `buildNotificationFromType(...)` directly for won/lost status changes — a cross-module import violating the "commands emit, subscribers react" rule. The command now emits `customers.deal.{won,lost}` events; two new subscribers under `packages/core/src/modules/customers/subscribers/` translate each event into the same notification payload. The notification contract (recipient, body, link, source-entity metadata) is unchanged.

### Audit-log projections for the CRM Changelog tab (new, additive)

The CRM detail pages add a **Changelog tab** (`packages/core/src/modules/customers/components/detail/ChangelogTab.tsx` + `ChangelogFilters`, `ChangelogEntryRow`, `ChangelogKpiCards`) that must filter audit-log entries by action type (`create|edit|delete|assign|system`), source (`ui|api|system`), and changed field. The existing `action_logs` table had no columns to drive those filters efficiently, so the following additive changes were made to the `audit_logs` module under the scope of SPEC-072:

- **Schema (Migration20260412160533)**: added 4 columns to `action_logs` (all nullable, no default value rewrites on existing rows): `action_type text`, `changed_fields text[]`, `primary_changed_field text`, `source_key text`. Added 4 additive indexes: GIN on `changed_fields`, and btree on `(tenant_id, organization_id, <col>, created_at)` for `primary_changed_field`, `source_key`, `action_type`.
- **Projection helpers** (`packages/core/src/modules/audit_logs/lib/projections.ts`, `packages/core/src/modules/audit_logs/lib/changeRows.ts`): derive the projection columns from existing `command_id`, `action_label`, `changes_json`, and `context_json`. Pure functions; no DB I/O.
- **Service updates** (`packages/core/src/modules/audit_logs/services/actionLogService.ts`): writes populate the new columns on every `ActionLog.create(...)`. The list query accepts additional filters (`actionType`, `sourceKey`, `fieldName`) mapped to the new columns. A `backfillProjections({ batchSize, force, organizationId, tenantId })` method re-projects existing rows in pages; runnable via the new CLI.
- **CLI** (`packages/core/src/modules/audit_logs/cli.ts`): new `audit_logs projection:backfill [--force] [--batch-size N] [--tenant …] [--organization …]` command to backfill historical data.
- **Export route** (`packages/core/src/modules/audit_logs/api/audit-logs/actions/export/route.ts`): new GET that accepts the same projection filters as the list endpoint and emits a CSV via the existing `serializeExport` helper. Gate matches the list route (`audit_logs.view_self` + `audit_logs.view_tenant` for cross-user access).

**Backward compatibility**: all columns are nullable and additive, so existing third-party readers of `action_logs` continue to work. Queries that do not supply the new filters behave exactly as before. The projection CLI is idempotent and safe to rerun. No existing rows are rewritten except by explicit `backfillProjections` invocation, and the backfill is scoped by tenant/organization filters.

**Why this lives in SPEC-072**: the Changelog tab is an in-scope deliverable of SPEC-072 Phase 5, and the audit-log projections are the minimum persistence work required to drive the tab's filters. Splitting into a separate spec would have produced two PRs that could not be merged independently (the UI has no data source without the columns; the columns have no consumer without the UI).

### Entity-role per-org feature check

`entity-roles-factory.ts` now invokes `rbacService.userHasAllFeatures(actorId, ['customers.roles.manage'], { tenantId, organizationId: entity.organizationId })` after resolving the target entity, in addition to the declarative `requireFeatures` metadata check. Tenants that grant `customers.roles.manage` per-organization will now see access correctly scoped to the entity's actual org; the previous behavior only validated that the entity's org was visible at all.

### Deprecation bridges

None required — the branch only adds surfaces or repairs under-specified behavior; no old surface was removed. When the legacy POST at `/api/customers/labels` was reshaped to delegate to the new `customers.labels.create` command, the URL, HTTP method, request body schema, response body schema, and status codes are preserved exactly; only the internal pipeline now flows through `commandBus.execute`.

### Consumer migration guidance

Third-party modules need no migration to keep working. Consumers that want to:
- **Subscribe to label/link/role/deal-closure events**: the new event IDs are declared and typed via `customers/events.ts` and `dictionaries/events.ts` (type-safe `emit` / workflow-trigger discovery).
- **Filter encrypted joined columns by `eq`**: works now when `searchEnabled` is set on the query (previously silently returned no rows).
- **Undo a role create that resurrected a soft-deleted row**: works correctly now — earlier behavior would have re-inserted the role instead of restoring the prior soft-delete.
- **Use `withAtomicFlush({ transaction: true })`**: the outer `em` is now genuinely bound to the transaction; earlier implementation allowed operations on `em` to escape the transaction under certain MikroORM versions.

## Changelog

| Date | Change |
| ---- | ------ |
| 2026-04-19 | Rev 5: Retroactively documented UX iterations that shipped alongside Phases 1–5 after the initial 2026-04-06 draft. Added "Additional UX Iterations" section covering Enhancements 6–16 (Company Dashboard tab + widgets, AI Action Chips, per-user Customer Labels, Dictionary Kind Settings, Dictionary Entry Reorder/Set-Default, Company Billing extension, Person-Company Roles junction, Deal Stage Transitions audit, Decision Makers Footer, Mini Week Calendar, Coming Soon Placeholder). Extended Implementation Phases table with Phases 5–8. Updated Scope list in TLDR. No contract or migration changes beyond what Rev 3/Rev 4 already documented in the Migration & Backward Compatibility section — the new tables, columns, events, routes and ACL features referenced here are the same ones already enumerated there. This revision closes the gap where the spec described the original 5 enhancements but the branch delivered 16 |
| 2026-04-18 | Rev 4: Post-review fixes. Documented `audit_logs` schema + service + CLI + export route additions that back the Changelog tab. Added `aria-*` semantics (`role="progressbar"`, `aria-valuenow`, `aria-valuetext`, `aria-current="step"`) to `PipelineStepper`. Added `Cmd/Ctrl+Enter` handler to `CreatePersonDialog`. Restored `data-component-handle` on the UMES example `PageBody` that was removed by an unrelated commit on this branch |
| 2026-04-17 | Rev 3: Added "Migration & Backward Compatibility" section covering every new contract surface introduced by the feat/crm-details-screens branch (new events, new commands, new routes, new tables, ACL features). Documented query engine `eq` semantic routing, `withAtomicFlush` transaction fix, label feature-gate kind-scoping, entity-role undelete undo, per-org feature check, and deals→notifications event-bus refactor |
| 2026-04-06 | Rev 2: Applied technical review — added Scope Classification, Out of Scope, form ownership contracts, stage transition rules, domain effects boundaries, v1 constraints, UMES extension boundary, Decisions to Confirm, additional risks, accessibility fixes |
| 2026-04-06 | Initial draft based on UX/UI meeting (2 April 2026) |
