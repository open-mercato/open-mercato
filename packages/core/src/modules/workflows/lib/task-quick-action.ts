/**
 * Workflows Module - Notification quick-action rule (pure)
 *
 * Spec §6.2: *"Notification quick-actions complete a decision inline **only
 * when** the task has exactly one-click semantics: no editable-prefilled fields
 * and no required comment — otherwise the quick action deep-links to the full
 * task."*
 *
 * What "one click" means here, and why each clause is load-bearing:
 *
 *  - **Exactly one decision, or none.** A notification action carries an
 *    `actionId`; the notifications module builds the command input from the
 *    notification's `sourceEntityId` alone (`notificationService.executeAction`),
 *    so WHICH of several buttons was pressed cannot reach the command. Two
 *    decisions therefore cannot be distinguished from a notification, and the
 *    honest answer is the deep link. (The platform's other command-backed
 *    notification — `staff.leave_request.pending` — sidesteps this by giving
 *    each button its OWN command id; workflow decisions are per-task data, so
 *    that is not available here.)
 *  - **No form fields.** Anything the assignee may type is input the quick
 *    action cannot collect, and completing with an empty payload would either
 *    fail `validateFormData` or silently discard what the author asked for.
 *  - **No editable-prefilled fields**, verbatim from the spec — a reviewer who
 *    is meant to correct data inline is not a one-click reviewer.
 *  - **No required comment.** There is no authoring surface for this today (the
 *    task detail's comment box is always optional), so the input defaults to
 *    false; it is modelled explicitly so the rule does not have to be rewritten
 *    when one appears.
 *
 * PURE: no ORM, DI, React or registry imports.
 */

import type { NotificationTypeAction } from '@open-mercato/shared/modules/notifications/types'
import { countTaskFormFields } from './task-form-schema'

export const TASK_COMPLETE_COMMAND_ID = 'workflows.tasks.complete'

/** Action id of the one-click completion button. */
export const TASK_QUICK_ACTION_COMPLETE_ID = 'complete'

/** Action id of the deep link to the full task. */
export const TASK_QUICK_ACTION_VIEW_ID = 'view'

export const TASK_DEEP_LINK_HREF = '/backend/tasks/{sourceEntityId}'

export interface TaskQuickActionInput {
  /** Decision buttons resolved for this task. */
  decisions?: { id: string }[] | null
  /** The authored form schema, in either accepted shape. */
  formSchema?: unknown
  /** Form fields the assignee may correct before deciding. */
  editablePrefilled?: string[] | null
  /** Reserved: no authoring surface exists yet, so callers leave it unset. */
  requiresComment?: boolean
}

/**
 * Whether this task can be finished from a notification with one click.
 *
 * Fail-closed by construction: every clause has to hold, and an unrecognised
 * form schema shape counts as "has fields" only when it actually declares any,
 * so a malformed schema degrades to the deep link rather than to a completion
 * that drops data.
 */
export function isOneClickTask(input: TaskQuickActionInput): boolean {
  if (input.requiresComment) return false
  if (input.editablePrefilled?.length) return false
  if (countTaskFormFields(input.formSchema) > 0) return false

  const decisions = input.decisions ?? []
  return decisions.length <= 1
}

/**
 * The actions a task notification offers.
 *
 * A one-click task gets the command-backed completion button; anything else
 * gets the deep link, which is what the spec's "otherwise" clause asks for. The
 * deep link is present in BOTH cases — a quick action is a shortcut, never the
 * only way to reach the task.
 */
export function buildTaskQuickActions(input: TaskQuickActionInput): NotificationTypeAction[] {
  const viewAction: NotificationTypeAction = {
    id: TASK_QUICK_ACTION_VIEW_ID,
    labelKey: 'common.view',
    variant: 'outline',
    href: TASK_DEEP_LINK_HREF,
    icon: 'external-link',
  }

  if (!isOneClickTask(input)) return [viewAction]

  return [
    viewAction,
    {
      id: TASK_QUICK_ACTION_COMPLETE_ID,
      labelKey: 'workflows.notifications.task.actions.complete',
      variant: 'default',
      icon: 'check',
      commandId: TASK_COMPLETE_COMMAND_ID,
    },
  ]
}

/**
 * The primary action id for a task notification: the completion button when
 * there is one, otherwise the deep link.
 */
export function resolveTaskPrimaryActionId(input: TaskQuickActionInput): string {
  return isOneClickTask(input) ? TASK_QUICK_ACTION_COMPLETE_ID : TASK_QUICK_ACTION_VIEW_ID
}
