/**
 * Work Inbox — status and priority presentation (PURE).
 *
 * Two rules the module is held to live here rather than inside the page:
 *
 * 1. **Design-system tokens only.** The retired task list hard-coded
 *    `bg-yellow-100` / `bg-blue-100` / `bg-green-100` badges and `text-red-600`
 *    overdue markers, none of which are dark-mode aware.
 * 2. **Status is never colour-only** (workflows AGENTS.md → canvas/status rule,
 *    spec §4.6). Every descriptor therefore pairs its token with an icon name
 *    AND keeps its own translated label, so the badge reads without colour.
 *
 * Icon *names* rather than components keep this file free of React so it can be
 * asserted as data.
 */

import type { TaskActionBlockReason } from '../../data/types'
import type { WorkInboxPriority } from './provider'

export type WorkInboxToneClasses = {
  badge: string
  icon: string
  text: string
}

export type WorkInboxStatusDescriptor = WorkInboxToneClasses & {
  iconName: WorkInboxIconName
}

export type WorkInboxIconName =
  | 'Clock'
  | 'Loader'
  | 'CheckCircle2'
  | 'XCircle'
  | 'AlertTriangle'
  | 'Flame'
  | 'ArrowUp'
  | 'Minus'
  | 'ArrowDown'
  | 'Circle'

const NEUTRAL: WorkInboxToneClasses = {
  badge: 'bg-status-neutral-bg text-status-neutral-text',
  icon: 'text-status-neutral-icon',
  text: 'text-status-neutral-text',
}

const INFO: WorkInboxToneClasses = {
  badge: 'bg-status-info-bg text-status-info-text',
  icon: 'text-status-info-icon',
  text: 'text-status-info-text',
}

const WARNING: WorkInboxToneClasses = {
  badge: 'bg-status-warning-bg text-status-warning-text',
  icon: 'text-status-warning-icon',
  text: 'text-status-warning-text',
}

const SUCCESS: WorkInboxToneClasses = {
  badge: 'bg-status-success-bg text-status-success-text',
  icon: 'text-status-success-icon',
  text: 'text-status-success-text',
}

const ERROR: WorkInboxToneClasses = {
  badge: 'bg-status-error-bg text-status-error-text',
  icon: 'text-status-error-icon',
  text: 'text-status-error-text',
}

const STATUS_DESCRIPTORS: Record<string, WorkInboxStatusDescriptor> = {
  PENDING: { ...WARNING, iconName: 'Clock' },
  IN_PROGRESS: { ...INFO, iconName: 'Loader' },
  COMPLETED: { ...SUCCESS, iconName: 'CheckCircle2' },
  CANCELLED: { ...NEUTRAL, iconName: 'XCircle' },
  ESCALATED: { ...ERROR, iconName: 'AlertTriangle' },
}

/** An unknown status from a third-party source still renders, neutrally. */
export function describeWorkInboxStatus(status: string): WorkInboxStatusDescriptor {
  return STATUS_DESCRIPTORS[status] ?? { ...NEUTRAL, iconName: 'Circle' }
}

const PRIORITY_DESCRIPTORS: Record<WorkInboxPriority, WorkInboxStatusDescriptor> = {
  extreme: { ...ERROR, iconName: 'Flame' },
  high: { ...WARNING, iconName: 'ArrowUp' },
  medium: { ...INFO, iconName: 'Minus' },
  low: { ...NEUTRAL, iconName: 'ArrowDown' },
}

export function describeWorkInboxPriority(
  priority: WorkInboxPriority | null,
): WorkInboxStatusDescriptor | null {
  return priority ? PRIORITY_DESCRIPTORS[priority] : null
}

export const WORK_INBOX_OVERDUE_TONE: WorkInboxStatusDescriptor = {
  ...ERROR,
  iconName: 'AlertTriangle',
}

export type TaskActionBlockDescriptor = WorkInboxToneClasses & {
  iconName: WorkInboxIconName
  /** Flat i18n key for the sentence a human can act on. */
  messageKey: string
  /**
   * The remedy §6.4 names, when there is one. `reassign` is the ONLY remedy the
   * model offers for an ownership refusal — administration widens seeing, never
   * acting, so taking the row is the supported path.
   */
  remedy: 'reassign' | null
}

/**
 * How an act refusal reads to a human (PURE).
 *
 * The reason itself is the SERVER's (`lib/task-visibility.ts`); this only says
 * which sentence and which DS tone render it, so the page never decides whether
 * an action is allowed. `unavailable` stays deliberately vague — it stands for
 * the entity-gate refusal the act routes answer as a bare 404, and widening it
 * into "binding X blocked you" would leak exactly what that 404 withholds.
 */
const TASK_ACTION_BLOCK_DESCRIPTORS: Record<TaskActionBlockReason, TaskActionBlockDescriptor> = {
  'not-workable': {
    ...INFO,
    iconName: 'CheckCircle2',
    messageKey: 'workflows.tasks.detail.cannotComplete',
    remedy: null,
  },
  'owned-by-another': {
    ...WARNING,
    iconName: 'AlertTriangle',
    messageKey: 'workflows.tasks.detail.blocked.ownedByAnother',
    remedy: 'reassign',
  },
  'not-in-your-queue': {
    ...WARNING,
    iconName: 'AlertTriangle',
    messageKey: 'workflows.tasks.detail.blocked.notInYourQueue',
    remedy: 'reassign',
  },
  unowned: {
    ...WARNING,
    iconName: 'AlertTriangle',
    messageKey: 'workflows.tasks.detail.blocked.unowned',
    remedy: 'reassign',
  },
  unavailable: {
    ...INFO,
    iconName: 'AlertTriangle',
    messageKey: 'workflows.tasks.detail.blocked.unavailable',
    remedy: null,
  },
}

/** An unknown reason from a newer server still renders, non-diagnostically. */
export function describeTaskActionBlock(reason: string): TaskActionBlockDescriptor {
  return (
    TASK_ACTION_BLOCK_DESCRIPTORS[reason as TaskActionBlockReason] ??
    TASK_ACTION_BLOCK_DESCRIPTORS.unavailable
  )
}
