# Notification Actions — Run Only Commands the Notification Type Declares

## TLDR

A notification action could dispatch any command through the command bus with no authorization beyond "signed in". The notification create routes accepted a caller-supplied `actions[].commandId`, and `POST /api/notifications/:id/action` dispatched whatever command was stored. This spec closes that path: API callers can no longer attach commands, and the action route dispatches only a command the notification's registered type declares, after checking the declared `requiredFeatures` for the clicking user. Tracked as [#7215](https://github.com/open-mercato/open-mercato/issues/7215). The request-shape narrowing ships under the [Emergency Security Exception](../../BACKWARD_COMPATIBILITY.md#emergency-security-exception).

## Status

Implemented — 2026-10-20 · Scope: OSS
Modules: `packages/core/src/modules/notifications/`, `packages/core/src/modules/staff/`, `packages/core/src/modules/workflows/`, `packages/shared/src/modules/notifications/`, `packages/ui/src/backend/notifications/`
Related: [`implemented/SPEC-003-2026-01-23-notifications-module.md`](implemented/SPEC-003-2026-01-23-notifications-module.md) (action model), [`2026-08-06-notifications-unresolved-tenant-scope-fail-closed.md`](2026-08-06-notifications-unresolved-tenant-scope-fail-closed.md) (same fail-closed pattern)

## Overview

A notification type (`notifications.ts`) declares buttons as `NotificationTypeAction`s. Producers copy them onto stored rows as `NotificationAction`s, and a click calls `POST /api/notifications/:id/action`, which marks the row actioned and, for an action with a `commandId`, executes that command as the clicking user. The command bus performs no per-command feature check. Many commands rely on their HTTP route's `requireFeatures` alone.

## Problem Statement

- `POST /api/notifications`, `/batch`, `/role` and `/feature` (gated by `notifications.create`) accepted `actions[].commandId` verbatim.
- `POST /api/notifications/:id/action` requires only authentication and dispatched the stored command.

Two attacks follow:

1. **Self-escalation:** a holder of `notifications.create` sends themselves a button wired to a command they cannot run, for example `wms.locations.delete`, whose route requires `wms.manage_locations`, and clicks it.
2. **Confused deputy:** the same user plants the button for a more privileged recipient, whose click runs the command with the recipient's identity.

Server-built actions had the same gap: the `staff.leave_request.pending` approve/reject buttons ran `staff.leave-requests.accept`/`reject` for a recipient who no longer held `staff.leave_requests.manage`.

## Proposed Solution

Invariant: **a notification action is never more permissive than the route that does the same thing.**

1. **Create routes refuse commands.** `rejectNotificationActionCommands` (`lib/routeHelpers.ts`) runs after payload validation and before the mutation guard and the write, in the single route and in `createBulkNotificationRoute`. Any action with a `commandId` answers `400 { error, code: "notification_action_command_not_allowed" }`. Link-only actions are unchanged.
2. **The action route dispatches only declared commands.** In `notificationService.executeAction`, a stored action with a `commandId` must match an action declared by the registered type with the same `id` **and** the same `commandId`, in `actions` or the new optional `optionalActions`. A stored action without a `commandId` never dispatches, so a command-less copy of a declared id cannot borrow its command.
3. **Declared features are checked, fail closed.** The declaration's optional `requiredFeatures` is checked with `rbacService.userHasAllFeatures` for the clicking user. A missing user, container or `rbacService`, or a throwing check, denies; the error is reported through `reportError`. A refusal answers `403 { error, code: "notification_action_forbidden" }`.
4. **Refusal is side-effect free.** The checks run before the atomic claim, so a refused click leaves the row unactioned.
5. **The command target is fixed.** The command input `id` is always the notification's `sourceEntityId`; `payload.id` no longer overrides it.
6. **Built-in declarations.** `staff.leave_request.pending` approve/reject declare `requiredFeatures: ['staff.leave_requests.manage']`. `workflows.task.assigned` declares the one-click `complete` action in `optionalActions`, built from the same `buildTaskQuickCompleteAction()` the producer uses, with `requiredFeatures: ['workflows.tasks.complete']`.
7. **UI feedback.** `useNotificationActions` sends `x-om-forbidden-redirect: 0` so the hook receives the 403 body, flashes the translated server message for coded errors (the generic `notifications.error.action` otherwise) and stays silent on the already-executed 409.

## Architecture

No new module, entity, DI registration, event or subscriber. Authorization lives in the service rather than the route so every caller of `executeAction` gets it. Declarations stay in each module's `notifications.ts`, so the module that owns a command also owns which notification buttons may run it.

## Data Models

No schema change. `NotificationTypeAction.requiredFeatures?: string[]` and `NotificationTypeDefinition.optionalActions?: NotificationTypeAction[]` are optional type additions; stored `action_data` keeps its shape.

## API Contracts

| Route | Change |
|---|---|
| `POST /api/notifications`, `/batch`, `/role`, `/feature` | New `400` with `code: notification_action_command_not_allowed` when any `actions[]` entry has a `commandId`. Request schema unchanged; OpenAPI documents the refusal |
| `POST /api/notifications/:id/action` | New `403` with `code: notification_action_forbidden` for an undeclared command or missing declared features; `payload.id` no longer retargets the command |

Both codes are exported from `@open-mercato/shared/modules/notifications/types` as `NOTIFICATION_ACTION_COMMAND_NOT_ALLOWED_ERROR_CODE` and `NOTIFICATION_ACTION_FORBIDDEN_ERROR_CODE`.

## Migration & Backward Compatibility

**Classification.** Two STABLE surfaces narrow: the create-route request shape (§7, `commandId` was a documented field of `notificationActionSchema`) and the action route's behaviour for stored command actions. Every other change is additive: two optional type fields, two exported constants and two i18n keys. Route URLs, methods, success response shapes, event IDs, ACL features, DI names, database schema and CLI commands are unchanged.

**Why the deprecation protocol does not apply.** The removed behaviour *is* the vulnerability. A bridge release that kept accepting caller-supplied `commandId`, or kept dispatching undeclared stored commands behind a flag, would leave both attacks open for the whole deprecation window. Rows planted through the API cannot be told apart from server-built ones by shape, so a warn-first mode would still execute them. The change is the narrowest that closes the hole: link-only actions, server-side producers using declared actions, and the claim/409 semantics are untouched, and no flag, config toggle or opt-in keeps the old path reachable.

**What stops working, for whom:**

- API clients that create notifications with `actions[].commandId` get `400` and nothing is created. Link-only actions still work.
- Modules whose producers attach a command action not declared on the type get `403` on click. They must declare it in `actions` or `optionalActions`.
- Recipients who lack a declared action's `requiredFeatures` get `403` on click; for built-in types this means staff leave decisions require `staff.leave_requests.manage`.
- Callers that relied on `payload.id` to retarget a command must create a notification per target entity.

**Client migration.** Create command-backed notifications from server code via `notificationService`, using an action declared on the type with `requiredFeatures` matching the route that normally runs the command. Branch on the two exported codes rather than on `error` text.

**Operator migration.** Upgrade all app and worker processes together. Pending rows with an undeclared command are refused automatically. A row created through the API before the upgrade that exactly copies a declared action stays executable for a recipient holding the declared features; review pending command actions with the query in [`UPGRADE_NOTES.md`](../../UPGRADE_NOTES.md#notification-action-commands). No database migration is needed.

**Exception bookkeeping.** `UPGRADE_NOTES.md` 0.9.0 → 0.9.1 carries the client and operator notes; `BACKWARD_COMPATIBILITY.md` has a dated entry linking to it; the PR carries the `security` label and needs a named human maintainer approval acknowledging the waiver.

## Testing

- Unit `api/__tests__/route.action-command.test.ts`: all four create routes refuse `commandId` and accept link-only actions.
- Unit `__tests__/notificationService.action-authorization.test.ts`: refusal before the claim for an unregistered type, an undeclared id, a mismatched command, a link-declared action, missing features, no `rbacService`, a throwing check and no user; dispatch for a matching declaration in `actions` and `optionalActions`; a command-less stored action never dispatches; `payload.id` cannot retarget.
- Contract tests in `staff` and `workflows`: declarations match their producers and reference features declared in each module's `acl.ts`.
- UI hook test: opt-out header, coded flash, generic fallback, silent 409.
- Integration `TC-NOTIF-020`: planted `wms.locations.delete` refused on the single and feature routes with the location surviving; leave approval refused without `staff.leave_requests.manage` and allowed once restored; the bell-panel **Approve** click shows the translated refusal.

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| Third-party producers attach undeclared command actions | Medium | Documented in `UPGRADE_NOTES.md`; the fix is a declaration in the module's own `notifications.ts` | Their buttons answer 403 until declared |
| Pre-upgrade API-planted rows that copy a declared action | Medium | Still gated by the declared `requiredFeatures`; operator query provided | Executable by a recipient who already holds the features |
| RBAC outage blocks every command action | Low | Fail-closed by design; error reported | Buttons refuse until RBAC recovers |
| Workflow one-click completion breaks | Low | Declared from the producer's own builder; contract test pins the match | None found |

## Final Compliance Report

- Tenant scoping unchanged; the feature check uses the notification service context's tenant and organization.
- No new raw `em.find`/`em.findOne`; i18n keys added in all five locales; errors carry `code`.
- Emergency Security Exception: qualifying argument and narrowest-removal argument above; `UPGRADE_NOTES.md` client and operator notes; dated `BACKWARD_COMPATIBILITY.md` entry; maintainer sign-off pending on the PR.

## Changelog

- 2026-10-20 — Spec written for #7215 to record the Migration & Backward Compatibility rationale of the shipped fix.
