# Workflow user tasks — completion-surface declaration

- **Status**: Implemented (pending merge)
- **Issue**: [#7179](https://github.com/open-mercato/open-mercato/issues/7179)
- **Module**: `packages/core/src/modules/workflows`
- **Related**: [`2026-07-15-contextual-workflow-task-actions.md`](./2026-07-15-contextual-workflow-task-actions.md), [`2026-07-26-workflows-ux-redesign.md`](./2026-07-26-workflows-ux-redesign.md) §6.1–§6.3, #7178 (completion guard)

## TLDR

A step can declare that a host module's own UI owns completion of its user task:

```json
"userTaskConfig": {
  "completion": { "surface": "host", "href": "/backend/invoices/{{context.invoiceId}}/approve" }
}
```

For such a task core offers no notification quick action, no Work Inbox `complete` row action and
no generic Complete form or decision buttons, and every deep link (notification row, its buttons
and therefore its email buttons, Work Inbox row, task page) points at the declared `href`. Without
an `href`, links keep pointing at `/backend/tasks/<id>`, where the host renders its UI through the
existing `workflows.task.detail:context` injection spot. A step that omits the key behaves exactly as
before.

## Problem

Some tasks can only be finished inside a host module's flow (multi-step dialogs, document
generation, external portals). Core still offered its generic affordances for them:

- the task detail form and Complete/decision buttons;
- the Work Inbox `complete` row action;
- the one-click notification quick action whenever a task has ≤1 decision and no form fields
  (`isOneClickTask`);
- deep links that always point to `/backend/tasks/<id>`.

A completion guard (#7178) keeps the data correct, but the user is still offered a button that
cannot work and is never led to where the work happens.

## Design

### Authored contract (additive)

`userTaskConfigSchema.completion` — optional:

| Key | Type | Meaning |
|-----|------|---------|
| `surface` | `'core' \| 'host'` | `'core'` (= absent) is today's behaviour; `'host'` hands completion to the host |
| `href` | `string?` | Same-origin backend path; `{{context.*}}` / `{{workflow.*}}` resolved once at task creation |

`href` must match `^/(?![/\\])\S*$` — a relative path with a single leading slash. Absolute,
protocol-relative and whitespace-bearing values are rejected by the schema, and again after
interpolation; a token that does not resolve (`{{…}}` left in the result) drops the `href`. Both
the schema and the post-interpolation check also apply the notification layer's own
`isSafeNotificationHref` (`@open-mercato/shared/modules/notifications/safeHref`), so an inner
backslash or a control character (U+0000–U+001F, U+007F) is refused too — otherwise the stored href
would reach `assertSafeNotificationHref`, which throws, and the whole notification would be lost
instead of falling back to the task page. All of these fail closed to the task page, so a link — including one in a notification email, which is rendered
from the stored href prefixed with the panel origin — never leaves the panel origin.

### Resolution and storage

`lib/task-completion.ts` (PURE) owns the rule. `handleUserTaskStep` resolves the declaration with
the same interpolator the rest of the task uses and stores the result on a new nullable
`user_tasks.completion` jsonb column (`{ surface: 'host', href: string | null }`, null for core).

Why a column rather than read-time derivation from the definition (the way decisions are derived):
the Work Inbox renders `detailHref` per row and would otherwise need the pinned definition and the
instance context for every row; and resolving once at creation is this module's rule for every
authored task value (a definition edit must not retro-change where a running task points).

Tasks created before this change have `completion = null` and behave exactly as before.

### Surfaces

| Surface | Host-owned task |
|---------|-----------------|
| `GET /api/workflows/tasks`, `/tasks/[id]`, Work Inbox rows | additive `completion` field (`null` for core) |
| Work Inbox row | `detailHref` = `href` (task page when none); no `complete` row action |
| Work Inbox "claim next" | navigates to the claimed row's `detailHref` |
| `workflows.task.assigned` notification | no `complete` quick action; `view` action and `linkHref` = `href` |
| `workflows.task.reminder_due` / `deadline_breached` | `view` action and `linkHref` = `href` |
| `/backend/tasks/[id]` | no generic form/decisions/Complete; an information notice links to `href` (or says the host UI renders below) |
| `/backend/tasks/[id]` on mobile | same notice; `MobileTaskForm` gets `offerCompletion={false}`, which withholds the form without being read as "already completed or cancelled" (that copy stays for a finished task) |
| Portal `GET /api/workflows/portal/tasks[/id]` | additive `completion` field (shared serializer) |
| `/<orgSlug>/portal/tasks/[id]` | for the assignee, no `PortalTaskForm`; links to `href` only when it is a path under `/<orgSlug>/portal/` (`resolvePortalTaskCompletionHref`), otherwise a notice that the task is completed outside the portal. A company reader who may not act keeps the read-only copy |

Events gain an additive optional `completion` payload key (`workflows.task.assigned`,
`workflows.task.reminder_due`, `workflows.task.deadline_breached`) so the notification subscribers
can decide without a read.

### Server-side consistency

The declaration is about the **surface**, never about **who may act**:

- `canComplete` / `actBlockedReason` keep their §6.4 meaning; a host flow completes through the same
  task API / `workflows.tasks.complete` command, so the server path — and any completion guard
  (#7178) — remains the single authority on whether a completion is accepted.
- The one-click notification action can only be executed if it was stored on the notification row
  (`notificationService.executeAction` looks the action up in the row's `actionData`), and a host
  task's notifications never store it, so the quick action cannot be replayed against a host task.

### Decisions

- **No automatic redirect from `/backend/tasks/[id]`.** The page is also the audit, claim, release
  and reassign surface; redirecting would hide them and could loop when a host page links back to
  the task. Links created from the task's own data (Work Inbox, notifications, email) point at the
  host directly; a bookmarked task URL lands on the page with a prominent link (one extra click).
- **No `spot` key.** The issue floated `{ surface: 'host', spot }`. The existing
  `workflows.task.detail:context` spot already renders any injected widget on the task page, so
  `{ surface: 'host' }` without an `href` covers it without a second contract.
- **No audience restriction on the declaration.** A customer-assigned task may declare a host
  surface too. The portal never links a customer to a backend path; a host that wants a portal
  link declares a portal path (e.g. `/{{context.orgSlug}}/portal/…`).
- **No Studio inspector field yet.** The key is authored in the Code view or the step's Advanced
  JSON; `graphToDefinition` preserves it from `userTaskConfig` so a Studio save never strips it.

## Backward compatibility

- Schema: additive optional key — an omitted key parses and behaves as before.
- DB: additive nullable column `user_tasks.completion` (migration `Migration20261111120000_workflows`).
- API: additive response field `completion`; no field removed or retyped.
- Events: additive optional payload key.
- UI: new i18n keys `workflows.tasks.detail.hostCompletion.*` and
  `workflows.portal.tasks.detail.hostCompletion.*` (all locales); existing test ids unchanged.
- `MobileTaskForm`: additive optional prop `offerCompletion` (default `true`), so existing callers
  render exactly as before.

## Risks & impact review

| Risk | Severity | Mitigation | Residual |
|------|----------|------------|----------|
| A crafted `href` sends users off-origin (phishing via email buttons) | High | Schema regex + post-interpolation re-check; unresolved tokens dropped; fallback to task page | Low — a same-origin path built from context values may still point at a wrong backend page |
| A host task is left with no way to complete when the host never renders anything | Medium | The task page states where completion happens; `canComplete`, reassign and the task API are unchanged, so an operator or the host can still complete via API | Medium — depends on the host module shipping its UI |
| A host href the notification layer refuses (backslash, control char) silently drops notifications | Medium | `isSafeTaskCompletionHref` composes `isSafeNotificationHref`; such an href resolves to `null` | Low |
| A customer is linked to a backend host page they cannot open | Medium | Portal links only to `/<orgSlug>/portal/…` hrefs; otherwise an informative notice | Low |
| A Studio save strips the key | Medium | `graphToDefinition` preserves `userTaskConfig.completion`; round-trip test | Low |
| Mismatch with #7189 (`deadlineAt` sibling key) | Low | Single adjacent line in `userTaskConfigSchema`; trivial merge | Low |

## Test coverage

- Unit: `lib/__tests__/task-completion.test.ts` (schema, resolution, fail-closed hrefs),
  `task-quick-action.test.ts`, `subscribers/__tests__/task-assigned-notification.test.ts`,
  `work-inbox-provider.test.ts`, `user-task-config.test.ts` (creation + Studio round trip),
  `backend/tasks/__tests__/taskDetailPage.test.tsx` (desktop and mobile),
  `backend/work-inbox/__tests__/workInboxPage.test.tsx` (host row has no `complete` row action,
  core row keeps it, claim-next opens the host), `frontend/__tests__/portal-tasks-pages.test.tsx`
  (portal host link vs. notice). Each includes the no-key regression case.
- Integration: `__integration__/TC-WF-077.spec.ts` — task detail API, Work Inbox `detailHref`,
  notification actions/link, and the task page, against a host definition and a control.

## Changelog

- 2026-11-11 — Initial spec and implementation (issue #7179).
- 2026-11-12 — Review/QA follow-up: completion hrefs also refuse what `isSafeNotificationHref`
  refuses (backslash, control chars); mobile task page no longer calls an active host task
  "already completed"; the portal task page honours the declaration (portal-path link or notice);
  Work Inbox row-action coverage moved to the page test.
