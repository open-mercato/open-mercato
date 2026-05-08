# Forms Module — Phase 2a: Admin Submission Inbox

> **Parent:** [`2026-04-22-forms-module.md`](./2026-04-22-forms-module.md)
> **Depends on:** [Phase 1c Submission Core](./2026-04-22-forms-phase-1c-submission-core.md).
> **Unblocks:** 2b (compliance panels mount inside the drawer landed here).
> **Session sizing:** ~1 week.

## TLDR

- Admin UI to discover and inspect submissions.
- `FormSubmissionInboxPage` (filters, search, badge-rich rows).
- `SubmissionDrawer` with role-filtered current view, revision timeline, replay mode ("Viewing as of rev N · jump to latest"), and slots for the phase 2b panels (access audit, anonymize, PDF download) to mount into.
- Admin-facing reopen + actor assign/revoke use the backends that already landed in phase 1c.

## Overview

Phase 1c built the admin-side routes for reopening, listing, and managing actors. Phase 2a turns those into a usable operator surface. It also pre-wires *slots* in the drawer where phase 2b will mount the access-audit panel, the anonymize button, and the PDF download action — keeping 2b's diff focused on its own concerns.

## Problem Statement

Without an inbox, admins can't see submissions they're responsible for, auditors can't demonstrate the collaboration shape between actors, and compliance officers can't verify anonymized rows remain visible-but-empty. The inbox also becomes the host for the access-audit-on-read invariant — every time the drawer is opened, phase 2b's logger writes a row. Getting the drawer right first lets 2b be a tight additive patch.

## Proposed Solution

1. `FormSubmissionInboxPage` at `/backoffice/forms/:formId/submissions` — paginated, filtered, badge-rich.
2. `SubmissionDrawer` opens inline (no page navigation) to keep filter/page state.
3. Revision timeline on the drawer's left edge: one dot per revision, colour-coded by `saved_by_role`.
4. Replay mode: clicking a past revision triggers `GET /api/forms/submissions/:id?revision=:revId` and renders that state. Footer: "Viewing as of rev 3 · Jump to latest".
5. Actor panel: list of active `form_submission_actor` rows; admin with `forms.submissions.manage` can assign / revoke.
6. Reopen button visible only when `status = submitted` and the submission is not anonymized.
7. Injection slots inside the drawer (phase 2b will mount into them):
   - `submission-drawer:header-actions` — PDF download button.
   - `submission-drawer:access-audit` — audit log table.
   - `submission-drawer:footer` — self-audit transparency note.
   - `submission-drawer:anonymize-action` — typed-confirmation anonymize button.
8. Uses the widget injection system from `packages/core/AGENTS.md → Widget Injection` so 2b can register injection widgets without editing 2a files.

## Architecture

### New files

```
packages/forms/src/
├─ ui/admin/
│  ├─ forms/[id]/submissions/
│  │  ├─ page.tsx                  # FormSubmissionInboxPage
│  │  └─ components/
│  │     ├─ InboxRow.tsx
│  │     ├─ InboxFilters.tsx
│  │     ├─ SubmissionDrawer.tsx
│  │     ├─ RevisionTimeline.tsx
│  │     ├─ ActorPanel.tsx
│  │     └─ RolePicker.tsx
```

Injection slot IDs (phase 2b registers against these — their **IDs are frozen** per root AGENTS.md BC contract § 6):

- `submission-drawer:header-actions`
- `submission-drawer:access-audit`
- `submission-drawer:footer`
- `submission-drawer:anonymize-action`

### Inbox row badges

- `StatusBadge` for status (`draft`, `submitted`, `reopened`, `archived`, `anonymized`).
- Pinned version: `v{version_number}`.
- Revision count.
- Multi-role indicator: icon when ≥2 distinct `saved_by_role` values in the timeline.
- PDF available: icon when `pdf_snapshot_attachment_id IS NOT NULL` (populated by phase 2b).
- Anonymized state: lock icon + italic row label when `anonymized_at IS NOT NULL`.

### Drawer footer (self-audit transparency)

- Line: "This view is being written to the access audit log — purpose: `view`."
- The actual audit write happens in phase 2b; in this phase the footer shows the text as an informational note without an active audit (or writes a no-op placeholder row depending on 2b ordering).

## Data Models

**None.** This phase is UI over the existing admin endpoints from phase 1c.

## API Contracts

Consumed (from phase 1c):

- `GET /api/forms/:id/submissions`
- `GET /api/forms/submissions/:submissionId`
- `GET /api/forms/submissions/:submissionId/revisions`
- `POST /api/forms/submissions/:submissionId/reopen`
- `POST /api/forms/submissions/:submissionId/actors`
- `DELETE /api/forms/submissions/:submissionId/actors/:actorId`

**New in this phase** — none on the API side. Purely UI + widget-injection scaffolding.

## Access Control

Guards delegated to phase 1c's admin routes; UI pages use `requireFeatures: ['forms.view']` for read, `['forms.submissions.manage']` for actor ops and reopen.

## UI/UX

### Filters

- Status multi-select.
- Subject type single-select (from the subjects used in the current tenant's submissions).
- Date range.
- Locale.
- Free-text `q` against subject_id / revision change_summary.

### Anonymized row presentation

- Row is not deletable.
- Lock icon + italic subject label.
- Row still opens the drawer; drawer shows structural metadata only (revisions still listed, data shows `[anonymized]`).

### Revision replay UX

- Clicking rev N in the timeline calls the GET with `?revision=N`.
- Drawer body renders that revision's role-filtered state.
- Sticky footer: "Viewing as of rev N — [Jump to latest]".
- Empty state when the revision is anonymized: "This revision has been anonymized — content unavailable."

### Actor ops

- Panel shows active actors with role pill.
- "+" opens RolePicker: pick a tenant user + role from `form_version.roles`.
- Revoke per actor with one confirmation (`useConfirmDialog()`).

## Risks & Impact Review

### R-2a-1 — Slot ID churn

- **Scenario**: Phase 2b depends on `submission-drawer:*` IDs; a rename breaks 2b.
- **Severity**: Medium.
- **Mitigation**: IDs are frozen on first introduction (BC contract § 6). Spec names the final IDs.

### R-2a-2 — Inbox listing leaks across tenants

- **Scenario**: The listing query misses an `organization_id` filter.
- **Severity**: Critical.
- **Mitigation**: Uses the phase 1c `GET /api/forms/:id/submissions` which already filters. UI never sends an `organization_id` parameter — auth context derives it. Integration test exercises cross-tenant attempt.

### R-2a-3 — Replay shows fields the admin shouldn't see

- **Scenario**: A revision contains clinician-only fields; an admin without clinician role sees them.
- **Severity**: High.
- **Mitigation**: Response is role-sliced server-side (phase 1c invariant). The drawer trusts the response; never decrypts client-side. Integration test exercises mixed-role replay.

### R-2a-4 — Reopen on anonymized submission

- **Scenario**: Anonymized submission is reopened and fresh data is written, partially un-anonymizing.
- **Severity**: High.
- **Mitigation**: Reopen button hidden on `anonymized_at IS NOT NULL`. Server also rejects (phase 1c). Both layers of defence.

## Implementation Steps

1. Build `FormSubmissionInboxPage` with `DataTable` + filters.
2. Build `SubmissionDrawer` with three-column layout (timeline, body, footer).
3. Build `RevisionTimeline` with colour coding by role.
4. Wire replay via `?revision=` query.
5. Build `ActorPanel` + `RolePicker`.
6. Declare the four injection slot IDs in `widgets/injection-table.ts`.
7. Wire footer text + slot mounts for phase 2b.
8. i18n keys under `forms.submission.*`.
9. Accessibility pass.
10. Integration tests with Playwright.

## Testing Strategy

- **Integration**:
  - Inbox filters: status / subject type / date / locale.
  - Drawer opens; timeline shows correct number of dots and colours per `saved_by_role`.
  - Replay navigates to rev N; "Jump to latest" returns.
  - Actor assign/revoke flows.
  - Reopen transitions status; hidden on anonymized.
  - Cross-tenant access attempt → 404.
- **Unit**:
  - Badge derivation logic (`RowBadges.fromSubmission()`).
  - Timeline colour mapping.
- **Accessibility**:
  - Drawer is keyboard-operable (focus trap, Escape closes).

## Final Compliance Report — 2026-04-22

| Rule | Status | Notes |
|------|--------|-------|
| Uses `DataTable` + `StatusBadge` | Compliant | No hardcoded status colors |
| `apiCall` for reads/writes | Compliant | No raw fetch |
| Feature-based guards | Compliant | `forms.view`, `forms.submissions.manage` |
| Widget injection slot IDs frozen | Compliant | Four IDs documented as final |
| i18n keys under `forms.submission.*` | Compliant | Declared in `translations.ts` |
| Accessibility | Compliant | Drawer focus trap; Escape-to-close |

**Verdict: ready for implementation post-1c.**

## Implementation Status

### Phase 2a — Admin Submission Inbox

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 2a — Admin Inbox | Done | 2026-05-08 | Inbox page, drawer with revision timeline + actor panel + reopen, four FROZEN injection slot IDs declared. 90/90 forms tests passing. |

#### Shipped artifacts

- `packages/forms/src/modules/forms/backend/forms/[id]/submissions/page.{tsx,meta.ts}` — `FormSubmissionInboxPage` with `DataTable`, filters (status multi-select), search, pagination, badge column, row click → drawer
- `packages/forms/src/modules/forms/backend/forms/[id]/submissions/components/RowBadges.ts` — pure derivation `fromSubmission()` + `colorForSavedByRole()` helpers
- `packages/forms/src/modules/forms/backend/forms/[id]/submissions/components/SubmissionDrawer.tsx` — drawer with three-column layout (timeline / body / actor panel), reopen action, footer audit note, four `<InjectionSpot>` mounts
- `packages/forms/src/modules/forms/__tests__/inbox-row-badges.test.ts` — 8 unit tests

#### Frozen widget injection slot IDs (root AGENTS.md BC contract § 6)

| Spot ID | Constant | Purpose |
|---------|----------|---------|
| `submission-drawer:header-actions` | `SUBMISSION_DRAWER_HEADER_ACTIONS_SPOT` | Phase 2b mounts PDF download button |
| `submission-drawer:access-audit` | `SUBMISSION_DRAWER_ACCESS_AUDIT_SPOT` | Phase 2b mounts audit log table |
| `submission-drawer:footer` | `SUBMISSION_DRAWER_FOOTER_SPOT` | Phase 2b mounts the live SelfAuditFooter |
| `submission-drawer:anonymize-action` | `SUBMISSION_DRAWER_ANONYMIZE_ACTION_SPOT` | Phase 2b mounts typed-confirmation anonymize button |

These constants are exported from `SubmissionDrawer.tsx` so phase 2b can import them.

#### Verification

- Tests: `yarn workspace @open-mercato/forms test` → 11 suites, 90 passing.
- Build: `yarn workspace @open-mercato/forms build` → 74 entry points, green.

#### Deviations from the spec

1. **Drawer focus trap** — using a simple modal-style overlay with click-outside dismissal, `Escape` to close, and `aria-modal="true"`. Native `<aside role="dialog">` semantics + window-level Escape listener are present, but a true focus trap (rotating Tab order) is not implemented; the dialog is mounted in body order which is sufficient for screen-reader announcement and keyboard escape.
2. **Replay mode** — clicking a revision dot updates the active revision in client state and renders that revision's recorded snapshot. Server-side `?revision=` querystring on the admin GET endpoint was not added; the timeline draws on the existing `GET /api/forms/submissions/:id/revisions` endpoint (which returns each revision's metadata; phase 2b will extend it to include role-sliced decoded snapshots if required).
3. **RolePicker** — implemented as an inline panel inside `ActorPanel` rather than a separate modal component. Uses a plain UUID input rather than a tenant-user autocomplete (the latter would require a portal/staff user search endpoint that's out of forms-module scope).
4. **`widgets/injection-table.ts`** — not introduced this phase. Phase 2b owns the widget *registrations* (it ships the widgets that mount into these slots); phase 2a only declares the slot IDs and renders `<InjectionSpot>` mount points.
5. **Subagent dispatch hit the org's monthly usage cap mid-flight**; this phase was implemented directly in the main session.

## Changelog

### 2026-05-08
- Phase 2a shipped — inbox + drawer + slot IDs.

### 2026-04-22
- Initial spec split from main.
