# Agent Orchestrator — UX Remediation Spec 1: P0 Hotfixes

> Part of the [UX remediation plan](./2026-07-12-ux-remediation-plan.md) (spec 1 of 5). Findings source:
> [`.ai/analysis/2026-07-12-agent-orchestrator-ux-audit.md`](../../../analysis/2026-07-12-agent-orchestrator-ux-audit.md) §P0.
> All file:line references verified against the working tree on 2026-07-12.

## TLDR

**Key Points:**
- Fixes the six ship-blocking UX defects found by the 2026-07-12 audit: the route collision that makes the entire Agentic Tasks UI unreachable, the wrong ACL gate on the Processes pages, success-flashing no-op case actions, three unconfirmed destructive deletes, fabricated Overview numbers presented as fact, and the Caseload inbox's hard 20-item ceiling.
- All changes are UI/meta-level inside `packages/enterprise/src/modules/agent_orchestrator/` plus one generator-level guard in `packages/cli` (route-collision detection). No entities, no migrations, no API contract changes.

**Scope:** six independently shippable fixes, one S-effort PR.

**Concerns:** the route-collision guard touches the `packages/cli` registry generator (cross-package; scoped to a hard error for *package-module* duplicates only, so intentional app-level page shadowing keeps working).

## Overview

The Agentic Tasks launcher, the process projection, and the trace-inspector real-data work all shipped on 2026-07-12. The same-day audit (7 code auditors + 1 live Playwright walkthrough) found the launcher unreachable and five more P0-severity defects on already-live surfaces. This spec is the "day-one" hotfix pass; specs 2–5 of the umbrella handle navigation, data honesty, operator throughput, and consistency.

> **Market Reference**: n/a — remediation of audited defects, not new capability. The confirmation-dialog and sample-labeling patterns follow the repo's own canon (`ConfirmDialog`, the trace inspector's `sampleLabel` chip).

## Problem Statement

| # | Audit ref | Defect (verified evidence) |
|---|-----------|----------------------------|
| 1 | P0-1 | Both core `workflows` and `agent_orchestrator` register `/backend/tasks`; workflows wins (generated `backend-routes.generated.ts:178` vs `:293`), so the sidebar's "Agentic Tasks" item renders the workflows User Tasks page and the launcher UI (list, create, Run-now, run history) is unreachable anywhere in the app. Nothing prevents the next such collision. |
| 2 | P0-2 | `backend/processes/page.meta.ts:19` and `backend/processes/[id]/page.meta.ts:6` still gate the interim `agent_orchestrator.trace.view` while `api/processes/route.ts:23` and `api/processes/[id]/route.ts:20` gate `agent_orchestrator.processes.view` — trace-view-only users see the page and 403 on every fetch; processes-view-only users can't see the page at all. |
| 3 | P0-3 | Processes detail renders Pause / Reassign / Take-over as enabled buttons (Take-over without `variant="outline"`, i.e. primary) whose `onClick` flashes `process.actionPreviewOnly` with tone `'success'` (`backend/processes/[id]/page.tsx:538-561`); the copy still says "design preview" on a live page. |
| 4 | P0-4 | Three destructive deletes fire on a single click with no confirmation: task delete (RowActions, `backend/tasks/page.tsx:494-509` — also tears down the cron registration via the CRUD hook), event-trigger delete (ghost trash button, `backend/tasks/[id]/page.tsx:459-466`), eval-assertion delete (`backend/eval-assertions/page.tsx:424-440`). |
| 5 | P0-5 | Overview's "Where humans stepped in" renders hardcoded demo figures (412/188/96/61/53, `backend/overview/page.tsx:239-246`) with no Sample marker, a dangling `Info` icon with no tooltip (`:404`), and a "View all" deep link into the real `/backend/audit` page whose data contradicts them; the header also hardcodes a "Claims adjudication" domain chip for every tenant (`:260`). |
| 6 | P0-6 | The Caseload inbox (primary decision view) renders only the currently loaded server page (`visibleRows`, default `pageSize` 20 — `backend/caseload/page.tsx:224,671-689`) and, unlike the list view (`:718+`), exposes no pagination affordance; the segment badge advertises the full pending total. |

## Proposed Solution

### 1. Route rename `/backend/tasks` → `/backend/agentic-tasks` + collision guard (Q1)

- `git mv packages/enterprise/src/modules/agent_orchestrator/backend/tasks packages/enterprise/src/modules/agent_orchestrator/backend/agentic-tasks` (auto-discovery derives the route from the directory path; both `page.meta.ts` files move with it).
- Update every internal reference (verified exhaustive list): `backend/agentic-tasks/[id]/page.meta.ts:8` breadcrumb `href`, `[id]/page.tsx:392` back button, `page.tsx:400` `cancelHref`, `page.tsx:479` + `:486` row navigation. Menu label stays "Agentic Tasks" (`agent_orchestrator.nav.tasks` — no copy change).
- Run `yarn generate`; confirm `backend-routes.generated.ts` registers `/backend/agentic-tasks` + `/backend/agentic-tasks/[id]` for `agent_orchestrator` and `/backend/tasks` remains solely `workflows`.
- **No redirect from `/backend/tasks`:** the launcher was never reachable there (workflows always won resolution), so no user bookmark can point at it; workflows User Tasks keeps the path. **No BC bridge:** the page route shipped earlier the same day, uncommitted — there is no released contract surface to deprecate (per `BACKWARD_COMPATIBILITY.md` this is a pre-release rename).
- **Collision guard (root cause):** the registry generator in `packages/cli` currently emits duplicate backend paths silently. Add detection in the backend-routes generation step: collect `path → [moduleId]`; if two **package modules** (anything not under `apps/*/src/modules/`) register the same backend path, fail generation with a message naming both modules and the path. App-local modules may still shadow package pages (legitimate override mechanism) — those log an informational note instead. Cover with a unit test in `packages/cli/src/lib/generators/__tests__/` (fixture with two modules registering one path → expect the error; app-module shadow → expect pass). This guard would have caught P0-1 at `yarn generate` time.

### 2. Processes ACL meta flip

Replace `requireFeatures: ['agent_orchestrator.trace.view']` with `['agent_orchestrator.processes.view']` in both metas and delete the four-line interim comment. `processes.view` is already declared in `acl.ts`, granted to employee/operator/engineer in `setup.ts`, and role-synced (F4 precedent applies — see Risks).

### 3. Processes detail: neutralize the stub actions

- All three buttons become `disabled` with `variant="outline"` (Take-over loses its primary styling — a disabled primary reads as "briefly unavailable", not "unbuilt").
- Because disabled buttons don't receive pointer events (tooltip-on-disabled is unreliable), add one muted caption line under the button group instead of tooltips: new key `agent_orchestrator.process.actionsComingSoon` — "Case actions (pause, reassign, take over) arrive with assignment support." ×4 locales.
- Delete the `onClick` flashes and the now-unused `process.actionPreviewOnly` key from all four locales (its "design preview" wording is false on a live page).

### 4. Delete confirmations ×3

Use the house `ConfirmDialog` (`@open-mercato/ui/backend/confirm-dialog`, `variant="destructive"`, `loading` while awaiting; the primitive owns the Cmd/Ctrl+Enter-confirm / Escape-cancel keyboard contract):

- **Task delete** (`backend/agentic-tasks/page.tsx` RowActions): confirm with blast-radius copy — title `tasks.confirmDelete.title` ("Delete this task?"), text `tasks.confirmDelete.text` ("Also unregisters its schedule and removes its event triggers. Runs already recorded stay in history."). The existing optimistic-lock header + `surfaceRecordConflict` flow moves inside `onConfirm` unchanged.
- **Event-trigger delete** (`backend/agentic-tasks/[id]/page.tsx`): confirm with `tasks.triggers.confirmDelete.text` naming the pattern being removed (interpolate `{pattern}`).
- **Eval-assertion delete** (`backend/eval-assertions/page.tsx`): confirm with `evalAssertions.confirmDelete.text` warning that runs stop being scored against it.

All keys ×4 locales. RowActions' `destructive: true` styling stays.

### 5. Overview honesty labels (Q3: keep, labeled)

- Add the trace inspector's sample-chip treatment to the "Where humans stepped in" section header: reuse the same visual (bordered muted chip as rendered for `sampleLabel` at `backend/traces/[id]/page.tsx:132-134`) with the existing key `agent_orchestrator.traces.detail.sample` hoisted to a shared key `agent_orchestrator.common.sample` (update both call sites to the new key — no alias; aliases rot).
- Wire the dangling `Info` icon: `title` + `aria-label` with new key `overview.interventions.sampleHint` ("Illustrative figures — the per-verb intervention taxonomy is not implemented yet.") ×4 locales. The "View all" audit link stays (acceptable once the section is labeled).
- Remove the "Claims adjudication" `ContextChip` (`backend/overview/page.tsx:260`) and delete `overview.domain` from all four locales. (The wider claims→neutral sweep belongs to spec 5 — this chip alone is P0 because it asserts a false fact about the tenant.)

### 6. Caseload inbox pager

Render the **existing pagination controls** (the list view's pager block, `backend/caseload/page.tsx:718+`) in the inbox branch too, plus a loaded-range label ("1–20 of 110", new key `caseload.inbox.range` with `{from}/{to}/{total}`) in the inbox footer. Rationale over load-more: `page`/`pageSize`/`total` state already exists and is server-driven; appending pages would complicate the coalesced live-reload reconciliation (which refetches the current page) and the bulk-selection model for zero UX gain. Selection semantics across page changes are unchanged (selection already resets on reload; preserving it is spec 4's scope).

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Generator-level collision guard (hard error) over a repo jest test | Catches the defect for every current and future module (incl. third-party) at `yarn generate` time — the root cause, not the symptom; jest-only would miss modules outside this repo. |
| App-module shadowing exempt from the hard error | Page overriding from `apps/*/src/modules/` is a legitimate extension mechanism; only package↔package duplicates are always bugs. |
| Disabled buttons + caption over tooltip-on-disabled | Disabled elements don't fire pointer events; a visible caption is a11y-robust and needs no wrapper hacks. |
| Inbox reuses the list pager instead of load-more | Zero new fetch/state logic; consistent with the sibling view; live-reload-safe. |
| No redirect from `/backend/tasks` | The agentic-tasks URL was never reachable (collision loser); redirecting would hijack workflows' legitimate page. |

## User Stories / Use Cases

- An **admin** clicks "Agentic Tasks" in the sidebar and lands on the Agentic Tasks list (not workflows User Tasks).
- An **operator** with `processes.view` opens Processes and every panel loads; a user with only `trace.view` no longer sees a page that 403s.
- An **operator** on a fraud-hold case sees Take-over greyed out with an explanation instead of a success flash that lied.
- An **admin** mis-clicking Delete on a scheduled task gets a confirmation naming the schedule/trigger blast radius.
- An **admin** reading the Overview can tell at a glance which section is illustrative.
- An **operator** with 110 pending proposals can reach item 21 from the inbox.

## Architecture / Data Models / API Contracts

No new components, entities, events, or endpoints. No schema changes. The only cross-package change is the `packages/cli` generator guard (build-time behavior; generated-file format unchanged).

## Internationalization (i18n)

New keys (×4 locales, sorted): `process.actionsComingSoon`, `tasks.confirmDelete.title|text`, `tasks.triggers.confirmDelete.text`, `evalAssertions.confirmDelete.text`, `common.sample` (or reuse decision per §5), `overview.interventions.sampleHint`, `caseload.inbox.range`. Removed keys: `process.actionPreviewOnly`, `overview.domain`.

## Migration & Compatibility

- Route rename: pre-release surface (shipped uncommitted same day) — no deprecation bridge required; stated per `BACKWARD_COMPATIBILITY.md` §page routes.
- ACL flip: no new grants needed (`processes.view` already granted + synced); existing tenants that have not run `yarn mercato auth sync-role-acls` since the projection landed must run it — same deploy note as F4 (add to RELEASE_NOTES).
- Generator guard: repos with a pre-existing package-level collision would fail `yarn generate` — that is the intent; message must name both modules.

## Implementation Plan

### Phase 1 — Unblock (steps 1–2, ship first)
1. Rename `backend/tasks` → `backend/agentic-tasks`; update the five internal references; `yarn generate`; verify both routes in the generated registry. *Test: unit — generated registry contains `/backend/agentic-tasks` for `agent_orchestrator` and `/backend/tasks` only for `workflows`.*
2. Flip both Processes metas to `processes.view`; remove interim comments. *Test: existing `runs-acl-rollout`-style unit asserting the meta gates match the API gates for processes list + detail.*

### Phase 2 — Guard (step 3)
3. `packages/cli` generator: duplicate-backend-path detection (package-module hard error, app-module info note) + unit tests (collision fixture, app-shadow fixture). *Ask-First gate: confirm the **generation-failing hard-error** semantics with the maintainer before implementing this phase — Q1 approved "a route-collision guard test", not necessarily a build-breaking generator error (downstream repos with pre-existing package-level collisions would fail `yarn generate`, which is the intent but a materially larger blast radius than a test). Fallback if declined: a repo-level unit test over the generated registry.*

### Phase 3 — Honesty & safety (steps 4–7, independent of each other)
4. Processes stub actions: disable, outline variant, caption line; remove `actionPreviewOnly`. 
5. Delete confirmations ×3 via `ConfirmDialog` (keep optimistic-lock + conflict-surface flows inside `onConfirm`).
6. Overview: sample chip + Info tooltip on the interventions section; remove the domain chip; key cleanup.
7. Caseload inbox pager + range label.

### File Manifest
| File | Action | Purpose |
|------|--------|---------|
| `backend/tasks/**` → `backend/agentic-tasks/**` | Rename | Route fix (5 internal refs updated) |
| `backend/processes/page.meta.ts`, `backend/processes/[id]/page.meta.ts` | Modify | ACL flip |
| `backend/processes/[id]/page.tsx` | Modify | Stub-action disable + caption |
| `backend/agentic-tasks/page.tsx`, `backend/agentic-tasks/[id]/page.tsx`, `backend/eval-assertions/page.tsx` | Modify | Delete confirmations |
| `backend/overview/page.tsx` | Modify | Sample chip, Info tooltip, domain-chip removal |
| `backend/caseload/page.tsx` | Modify | Inbox pager + range label |
| `i18n/{en,es,de,pl}.json` | Modify | Keys per §i18n |
| `packages/cli/src/lib/generators/…` (+ `__tests__/`) | Modify/Create | Collision guard + tests |

### Testing Strategy / Integration Coverage (required)

Unit: generator collision tests; meta↔API ACL parity test; ConfirmDialog wiring smoke (RTL) for the task delete path.

Playwright (implement with this change, self-contained fixtures):
- **TC-AGENT-UX-P0-001** — `/backend/agentic-tasks` renders the Agentic Tasks list for an engineer role; `/backend/tasks` renders workflows User Tasks; the sidebar "Agentic Tasks" item navigates to the former.
- **TC-AGENT-UX-P0-002** — Processes list + detail load (200s on `api/processes*`) for a `processes.view` role; the menu item is absent for a role without it.
- **TC-AGENT-UX-P0-003** — Task delete: cancel keeps the row; confirm removes it and flashes; trigger + assertion confirms present (dialog visible before any DELETE fires).
- **TC-AGENT-UX-P0-004** — Seed 25 pending proposals; inbox shows "1–20 of 25" and page 2 reaches the remaining 5; disabled Pause/Reassign/Take-over buttons asserted on a process detail.
- **TC-AGENT-UX-P0-005** — Overview renders the sample chip on the interventions section and no "Claims adjudication" chip.

## Risks & Impact Review

#### Route rename misses a hardcoded link
- **Scenario**: an overlooked `router.push('/backend/tasks')` inside the module silently navigates to workflows.
- **Severity**: Medium · **Affected area**: agentic-tasks navigation.
- **Mitigation**: the five references above were found by exhaustive grep; TC-AGENT-UX-P0-001 covers the primary paths; a module-wide grep for `/backend/tasks` is a step-1 exit criterion.
- **Residual risk**: none meaningful.

#### Generator guard false-positives block builds
- **Scenario**: a legitimate app-level page override trips the hard error and `yarn generate` fails for downstream apps.
- **Severity**: High if unscoped · **Affected area**: every consumer repo's build.
- **Mitigation**: hard error restricted to package↔package duplicates; app-module shadowing logs info only; both cases unit-tested.
- **Residual risk**: a third party shipping two *package* modules that intentionally share a path — rejected by design (that is exactly the bug class).

#### ACL flip hides Processes from stale-role tenants
- **Scenario**: a tenant that never ran `auth sync-role-acls` after the projection landed loses the menu item for operator roles.
- **Severity**: Medium · **Affected area**: Processes visibility.
- **Mitigation**: RELEASE_NOTES + scaling-runbook deploy step (F4 precedent); superadmin/admin wildcard unaffected.
- **Residual risk**: acceptable — the current state (page 403s) is strictly worse.

#### Confirmation dialogs slow bulk cleanup
- **Scenario**: an admin deleting many assertions now clicks twice per row.
- **Severity**: Low · **Mitigation**: none needed in P0 (bulk delete is not a current feature). **Residual**: acceptable.

Data-integrity, tenant-isolation, and cascading-failure categories: no changes to writes, scoping, or events in this spec beyond moving existing delete calls inside `onConfirm` (transactional behavior unchanged).

## Final Compliance Report — 2026-07-12

### AGENTS.md Files Reviewed
- `AGENTS.md` (root) · `packages/core/AGENTS.md` · `packages/ui/AGENTS.md` · `packages/enterprise/src/modules/agent_orchestrator/AGENTS.md` · `packages/cli/AGENTS.md` · `.ai/specs/AGENTS.md` · `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix
| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | Never hard-code user-facing strings | Compliant | All new copy via i18n keys ×4 |
| root AGENTS.md | Dialogs: Cmd/Ctrl+Enter submit, Escape cancel | Compliant | `ConfirmDialog` primitive owns the contract |
| root AGENTS.md | Integration coverage listed for affected API/UI paths | Compliant | §Testing Strategy TC-AGENT-UX-P0-001…005 |
| packages/ui/AGENTS.md | Use shared primitives; no raw fetch; guarded mutations | Compliant | Existing `deleteCrud` + lock headers move inside `onConfirm` unchanged |
| .ai/ds-rules.md | No hardcoded status colors / arbitrary values | Compliant | No new styling beyond existing tokens |
| BACKWARD_COMPATIBILITY.md | Contract-surface changes need deprecation protocol | Compliant | Route is pre-release (same-day, uncommitted) — no bridge; stated in §Migration |
| packages/cli/AGENTS.md | Generator changes covered by generator tests | Compliant | Phase 2 unit tests |
| root AGENTS.md | `yarn generate` after module-file changes | Compliant | Step 1 + registry verification |

### Internal Consistency Check
| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | No data/API changes |
| API contracts match UI/UX section | Pass | UI-only |
| Risks cover all write operations | Pass | Deletes covered; no new writes |
| Commands defined for all mutations | Pass | No new mutations |
| Cache strategy covers all read APIs | Pass | No new reads |

### Non-Compliant Items
None.

### Verdict
**Fully compliant** — ready for implementation.

## Changelog

### 2026-07-12
- Initial specification (from audit P0 findings; Q1/Q3 decisions applied from the umbrella gate).
- Post-review fixes applied per fresh-context architectural review: M-6 (cli generator hard error is an explicit Ask First gate, not pre-approved), L-4 (sample key: update both call sites, no alias); `overview.domain` key deletion ownership confirmed here (M-1 — spec 5 verifies only).
- **Implemented** (all three phases, one commit each on `feat/agent-orchestrator-mvp`):
  - Phase 1 `73b87cd9b` — route rename to `/backend/agentic-tasks` (5 refs, registry verified), Processes meta ACL flip, guard tests (`agentic-tasks-route.test.ts`, `processes-page-acl.test.ts`).
  - Phase 2 `41ad6a23a` — `packages/cli` route-collision guard (`route-collisions.ts` detector wired into `generateModuleRegistry` before output; package↔package = hard error, app shadowing = `[Route Shadow]` note; 7 tests). **Ask First resolved: maintainer approved hard-error semantics in-session.**
  - Phase 3 `c243a4569` — stub actions disabled+caption, delete confirms ×3 via `useConfirmDialog`, Overview sample chip (`common.sample` hoist) + Info tooltip + domain-chip removal, inbox pager + range label; 8 i18n keys added / 3 removed ×4; `p0-honesty-safety.test.ts` + TC-AGENT-UX-P0-003…005 authored.
  - Deviations: step-1 registry test encodes the invariant at source level (generated registry is gitignored); Phase-3 commit includes earlier same-day uncommitted cockpit edits interleaved in the five shared pages + i18n catalogs (disclosed in the commit body; unsplittable without hunk surgery).
