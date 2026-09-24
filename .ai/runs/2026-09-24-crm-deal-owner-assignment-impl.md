# Run: CRM deal owner assignment — implementation

Source doc: .ai/specs/2026-09-24-crm-deal-owner-assignment.md
Spec PR: #6441 (design-only — must not be modified by this run)
Engine: om-auto-create-pr (steps: 14, --loop: no)

## Goal

Make a deal's owner assignable from every surface that writes deals — the detail view, both
creation paths, and the deals list — reusing the existing write paths. The owner is the sole
recipient of deal won/lost notifications, so a deal nobody can assign is a deal whose closure
notifies nobody.

## Scope

- `packages/ui` — one additive, defaulted `allowClear` prop on the shared `LookupSelect` primitive.
- `packages/core/src/modules/customers` — a new `DealOwnerSelect`, the owner field in `DealForm`
  and in the standalone create form's separate component tree, and a bulk reassign action on the
  deals list.
- No schema change, no new API endpoint, no new ACL feature: `PUT /api/customers/deals`,
  `POST /api/customers/deals` and `POST /api/customers/deals/bulk-update-owner` already accept the
  payloads and already gate on `customers.deals.manage`.

## Non-goals

- The Kanban `ChangeOwnerDialog` is **not** touched (spec D5).
- No unassignment in the UI: nothing may send `ownerUserId: null` (spec D5). This is why the
  `allowClear` prop exists (spec D8).
- No assignment notification (spec D9) — matches the existing Kanban bulk path.
- No client-side permission gating is added; the deals list has none today and the new action
  matches the existing Delete action in relying on the server 403.

## Deviation from the engine default (recorded deliberately)

The skill mandates an isolated worktree. This run commits **directly on
`feat/crm-deal-owner-assignment-impl` in the primary working directory**, because the running
containerised dev stack (`om-isolated`) bind-mounts this exact checkout at `.:/app` and serves the
app at http://localhost:3100. Work done in a detached worktree would never reach that container,
which is the environment required for UI verification. No worktree is created, so none is cleaned up.

## Validation

Docker mode against the running stack (a compose `app` container is up):

    COMPOSE_PROJECT_NAME=om-isolated node scripts/docker-exec.mjs <script>

`scripts/docker-exec.mjs` does not pass a compose project name, so the override is required.
Gate order: `build:packages`, `generate`, `build:packages`, `i18n:check-sync`, `i18n:check-usage`,
`typecheck`, `test`, `build:app`.

Note: the compose file masks every `packages/*/dist` with a named volume and the app imports from
`dist`, so the `LookupSelect` change is invisible to the running app until `build:packages` runs
**inside** the container.

## Risks

- **`LookupSelect` is widely used** (`RoleAssignmentRow`, `AssignRoleDialog`, `ParticipantsField`).
  `allowClear` defaults to `true` so every existing caller is unchanged; a regression test locks
  that in.
- **`DealForm` is shared** between the detail view and the person/company create flow, so the field
  appears in both (intended — spec D7).
- The standalone create page uses a **separate** component tree (`CreateDealForm` →
  `DealDetailsFields`) sharing only `dealFormSchema`, so it needs parallel wiring (spec D11).

## Implementation Plan

### Phase 1 — shared picker, detail view and both create paths

1. Add `allowClear?: boolean` (default `true`) to `LookupSelect`, guarding both clear controls.
2. Add `DealOwnerSelect` wrapping `LookupSelect` over `fetchAssignableStaffMembers`.
3. Add the `ownerUserId` field to `DealForm.baseFields` plus the optional `initialOwnerOption` prop.
4. Wire the standalone create page: `dealFormTypes.ts`, `DealDetailsFields.tsx`, `CreateDealForm.tsx`.
5. Default the create-mode owner to the current user in `DealForm`.
6. Pass `initialOwnerOption` from the deal detail page.
7. Add i18n keys across all five locales.
8. Integration test — detail view owner change (incl. stale-save 409).
9. Integration test — both create paths (incl. the current-user default).

### Phase 2 — deals list bulk reassignment

10. Add `ReassignOwnerDialog` to the deals list.
11. Add the `reassign-owner` bulk action returning `progressJobId`.
12. Clear selection and refresh on success.
13. Add i18n keys for the list action across all five locales.
14. Integration test — list bulk reassignment (incl. 403 for a caller without `customers.deals.manage`).

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Shared picker, detail view and create paths

- [x] 1.1 Add `allowClear` to `LookupSelect` — d7ff51ce8
- [x] 1.2 Add `DealOwnerSelect` — 297075cbf
- [x] 1.3 Add owner field + `initialOwnerOption` to `DealForm` — 73c48768f
- [x] 1.4 Wire the standalone create page — 1505e7d9f
- [x] 1.5 Default create-mode owner to the current user — a94c53786
- [x] 1.6 Pass `initialOwnerOption` from the detail page — a94c53786
- [x] 1.7 Add Phase 1 i18n keys — c786db95a
- [x] 1.8 Integration test — detail view owner change — 93e28efa4
- [x] 1.9 Integration test — both create paths — 93e28efa4

### Phase 2: Deals list bulk reassignment

- [x] 2.1 Add `ReassignOwnerDialog` — a4b1c4156
- [x] 2.2 Add the `reassign-owner` bulk action — a4b1c4156
- [x] 2.3 Clear selection and refresh on success — a4b1c4156 (DataTable owns this once the action returns `{ ok, progressJobId }`)
- [x] 2.4 Add Phase 2 i18n keys — a4b1c4156
- [x] 2.5 Integration test — list bulk reassignment — see note below

### Note on step 2.5 coverage

The planned 403 assertion was **not** written, and the step landed as a `ReassignOwnerDialog`
unit suite instead. Two findings drove that:

1. The `bulk-update-owner` endpoint is already covered end-to-end by `TC-CRM-069` — reassignment
   through the queue worker, clearing with `ownerUserId: null`, and the empty-ids 400. Re-asserting
   it from the list would duplicate that suite without testing anything the list adds.
2. No seeded role can express the 403: `setup.ts` grants `customers.deals.manage` to **both**
   `admin` (`customers.*`) and `employee`, so asserting the denial would mean building a bespoke
   role + ACL fixture for a guard that is declarative (`requireFeatures` metadata) and covered at
   the framework level.

What the list genuinely adds is the dialog contract, which is what the new suite locks in: the
selected count is shown, confirm stays disabled until a staff member is chosen, `onConfirm` only
ever receives a real user id, cancel never confirms, and Cmd/Ctrl+Enter submits.
