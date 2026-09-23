/**
 * Task inspector ↔ `userTaskConfig` mapping (spec §6.1).
 *
 * PURE by construction (no React, ORM, DI or xyflow imports): the inspector
 * sections are thin controls over the drafts this module produces, so every
 * rule about what a save writes is unit-testable without rendering a dialog.
 *
 * The governing rule everywhere below is UNTOUCHED MEANS UNCHANGED. A config
 * that carried no inspector vocabulary must serialize byte-identically after a
 * save that never touched these sections, and a value the author did not edit
 * must come back in the shape it was authored in — that is why every mapper
 * takes the ORIGINAL alongside the edited draft rather than rebuilding from
 * the draft alone.
 */

import { flattenTaskText } from './task-resolution'
import type {
  TaskDeadline,
  TaskDecision,
  TaskEntityBinding,
  TaskLocalizedString,
  TaskOnBreach,
  TaskPriority,
  TaskReminder,
  UserTaskAssigneeKind,
  UserTaskConfig,
} from '../data/validators'

/** Mirrors the platform's priority labels; `''` is "not set". */
export const TASK_PRIORITY_VALUES: readonly TaskPriority[] = ['low', 'medium', 'high', 'extreme'] as const

export const TASK_ON_BREACH_ACTIONS: readonly TaskOnBreach['action'][] = ['notify', 'reassign', 'route'] as const

export const TASK_DECISION_STYLES: readonly NonNullable<TaskDecision['style']>[] = [
  'primary',
  'secondary',
  'destructive',
] as const

/**
 * Which of the four §6.1 assignment tabs a stored config belongs to. Derived,
 * never persisted: the tab IS the three assignment keys, so there is no fifth
 * source of truth to keep in sync.
 */
export type TaskAssignmentMode = 'role' | 'user' | 'dynamic' | 'rule'

/**
 * Which principal namespace the task is addressed to (design §7.1). `'user'` is
 * the backoffice; `'customer'` is a portal principal, and the only value the
 * engine treats as portal work.
 */
export const TASK_ASSIGNEE_KINDS: readonly UserTaskAssigneeKind[] = ['user', 'customer'] as const

/**
 * The assignment modes each audience can actually be EXECUTED in — read off
 * `resolveTaskAssignment`, not off what the tab strip happens to render.
 *
 * `assigneeKind: 'customer'` is honoured ONLY when an individual assignee
 * resolves to a non-empty string, and it forces `assignedToRoles` to null. So
 * the two modes that name no individual are inert for a portal task: a role
 * queue leaves `assignedTo` null (the row is created backoffice), and
 * `assignmentRule` is not read by `resolveTaskAssignment` at all. Offering them
 * under the customer audience would be offering an author a control the engine
 * silently discards.
 *
 * Order mirrors the full list so a tab does not move when the audience changes.
 */
export const TASK_ASSIGNEE_KIND_MODES: Record<UserTaskAssigneeKind, readonly TaskAssignmentMode[]> = {
  user: ['role', 'user', 'dynamic', 'rule'],
  customer: ['user', 'dynamic'],
}

export function isTaskAssigneeKind(value: unknown): value is UserTaskAssigneeKind {
  return typeof value === 'string' && (TASK_ASSIGNEE_KINDS as readonly string[]).includes(value)
}

/**
 * The audience a stored config opens on. Absent means `'user'` — which is what
 * every definition authored before the key existed has always meant, and why
 * nothing has to be written for the default.
 */
export function deriveTaskAssigneeKind(
  config: Pick<UserTaskConfig, 'assigneeKind'>,
): UserTaskAssigneeKind {
  return config.assigneeKind === 'customer' ? 'customer' : 'user'
}

export function assignmentModesForAssigneeKind(
  kind: UserTaskAssigneeKind,
): readonly TaskAssignmentMode[] {
  return TASK_ASSIGNEE_KIND_MODES[kind] ?? TASK_ASSIGNEE_KIND_MODES.user
}

/**
 * The tab a mode collapses to when the audience no longer offers it.
 *
 * Only the customer audience narrows the set, and what it drops are the two
 * modes that name no individual. Landing on Dynamic rather than on the first
 * remaining tab is the honest default: a portal principal's id comes out of the
 * run context, it is not a literal an author types.
 */
export function coerceAssignmentModeToAssigneeKind(
  mode: TaskAssignmentMode,
  kind: UserTaskAssigneeKind,
): TaskAssignmentMode {
  const allowed = assignmentModesForAssigneeKind(kind)
  if (allowed.includes(mode)) return mode
  if (allowed.includes('dynamic')) return 'dynamic'
  return allowed[0] ?? 'role'
}

/**
 * What the audience picker writes back.
 *
 * `'customer'` is the only value the engine acts on, so it is the only value
 * that has to be persisted: a step left on the backoffice audience writes
 * NOTHING and a config that never declared the key serializes byte-identically
 * after a save that opened the inspector. The one exception is a config that
 * already spelled `'user'` explicitly — the same "untouched means unchanged"
 * rule `resolveTaskDeadlinePersistence` follows for its two keys, so opening the
 * inspector never rewrites a shape the author chose.
 */
export function resolveTaskAssigneeKindPersistence(
  original: UserTaskAssigneeKind | undefined,
  edited: UserTaskAssigneeKind,
): UserTaskAssigneeKind | undefined {
  if (edited === 'customer') return 'customer'
  return original === 'user' ? 'user' : undefined
}

export interface TaskEntityBindingDraft {
  /** Stable React key; never persisted. */
  key: string
  entityType: string
  idPath: string
  label: string
  /** The authored label before editing, so a locale map survives an untouched save. */
  labelSource?: TaskLocalizedString
}

export interface TaskOnBreachDraft {
  action: '' | TaskOnBreach['action']
  reassignTo: string
  transitionId: string
}

export interface TaskDecisionDraft {
  /** Stable React key; never persisted (the durable `id` below is). */
  key: string
  id: string
  label: string
  labelSource?: TaskLocalizedString
  transitionId: string
  style: '' | NonNullable<TaskDecision['style']>
}

const TEMPLATE_TOKEN_PATTERN = /\{\{[^}]+\}\}/

let draftKeyCounter = 0

function nextDraftKey(prefix: string): string {
  draftKeyCounter += 1
  return `${prefix}_${draftKeyCounter}`
}

/** A durable, opaque decision id — never an index, never derived from the label. */
export function generateDecisionId(): string {
  return `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`
}

/** The single-line form of authored copy, for editing in a plain control. */
export function flattenTaskTextForEditing(value: TaskLocalizedString | undefined | null): string {
  return flattenTaskText(value) ?? ''
}

/**
 * Write edited copy back. Text identical to what the control was seeded with
 * returns the ORIGINAL value, so a locale map an author never touched is never
 * flattened to the tenant default by opening the inspector.
 */
export function applyEditedTaskText(
  original: TaskLocalizedString | undefined | null,
  edited: string,
): TaskLocalizedString | undefined {
  if (!edited.trim().length) return undefined
  if (original != null && flattenTaskTextForEditing(original) === edited) return original
  return edited
}

export function isTaskPriority(value: unknown): value is TaskPriority {
  return typeof value === 'string' && (TASK_PRIORITY_VALUES as readonly string[]).includes(value)
}

/**
 * Which tab a stored assignment opens on. An `assignedTo` carrying a `{{…}}`
 * pill is Dynamic; a plain one is User; a business rule wins over both because
 * it is the only form the engine resolves through another module.
 */
export function deriveTaskAssignmentMode(
  config: Pick<UserTaskConfig, 'assignedTo' | 'assignmentRule'>,
): TaskAssignmentMode {
  if (typeof config.assignmentRule === 'string' && config.assignmentRule.length > 0) return 'rule'
  const assignedTo = config.assignedTo
  if (typeof assignedTo === 'string' && assignedTo.length > 0) {
    return TEMPLATE_TOKEN_PATTERN.test(assignedTo) ? 'dynamic' : 'user'
  }
  return 'role'
}

export function entityBindingsToDrafts(
  bindings: TaskEntityBinding[] | undefined | null,
): TaskEntityBindingDraft[] {
  if (!Array.isArray(bindings)) return []
  return bindings.map((binding) => ({
    key: nextDraftKey('binding'),
    entityType: typeof binding?.entityType === 'string' ? binding.entityType : '',
    idPath: typeof binding?.idPath === 'string' ? binding.idPath : '',
    label: flattenTaskTextForEditing(binding?.label),
    ...(binding?.label != null ? { labelSource: binding.label } : {}),
  }))
}

/** Rows missing an entity type or an id path describe nothing and are dropped. */
export function draftsToEntityBindings(
  drafts: TaskEntityBindingDraft[] | undefined | null,
): TaskEntityBinding[] | undefined {
  if (!Array.isArray(drafts)) return undefined
  const bindings = drafts.reduce<TaskEntityBinding[]>((acc, draft) => {
    const entityType = draft.entityType.trim()
    const idPath = draft.idPath.trim()
    if (!entityType || !idPath) return acc
    const label = applyEditedTaskText(draft.labelSource, draft.label)
    acc.push({ entityType, idPath, ...(label !== undefined ? { label } : {}) })
    return acc
  }, [])
  return bindings.length > 0 ? bindings : undefined
}

export function remindersToOffsets(reminders: TaskReminder[] | undefined | null): string[] {
  if (!Array.isArray(reminders)) return []
  return reminders.map((reminder) => (typeof reminder?.offset === 'string' ? reminder.offset : ''))
}

export function offsetsToReminders(offsets: string[] | undefined | null): TaskReminder[] | undefined {
  if (!Array.isArray(offsets)) return undefined
  const reminders = offsets
    .map((offset) => (typeof offset === 'string' ? offset.trim() : ''))
    .filter((offset) => offset.length > 0)
    .map((offset) => ({ offset }))
  return reminders.length > 0 ? reminders : undefined
}

export function onBreachToDraft(onBreach: TaskOnBreach | undefined | null): TaskOnBreachDraft {
  return {
    action: onBreach?.action ?? '',
    reassignTo: onBreach?.reassignTo ?? '',
    transitionId: onBreach?.transitionId ?? '',
  }
}

/** Only the qualifier the chosen action actually uses is persisted. */
export function draftToOnBreach(draft: TaskOnBreachDraft | undefined | null): TaskOnBreach | undefined {
  const action = draft?.action
  if (!action) return undefined
  if (action === 'reassign') {
    const reassignTo = draft?.reassignTo.trim() ?? ''
    return reassignTo ? { action, reassignTo } : { action }
  }
  if (action === 'route') {
    const transitionId = draft?.transitionId.trim() ?? ''
    return transitionId ? { action, transitionId } : { action }
  }
  return { action }
}

export function decisionsToDrafts(decisions: TaskDecision[] | undefined | null): TaskDecisionDraft[] {
  if (!Array.isArray(decisions)) return []
  return decisions.map((decision) => ({
    key: nextDraftKey('decision'),
    id: typeof decision?.id === 'string' ? decision.id : '',
    label: flattenTaskTextForEditing(decision?.label),
    ...(decision?.label != null ? { labelSource: decision.label } : {}),
    transitionId: typeof decision?.transitionId === 'string' ? decision.transitionId : '',
    style: decision?.style ?? '',
  }))
}

/**
 * A decision without a durable id or a route it points at is not a button the
 * task surface could render, so it is dropped rather than persisted broken. A
 * decision whose route was DELETED still persists — that is the Problems-panel
 * warning's job, not a silent deletion of the author's work.
 */
export function draftsToDecisions(
  drafts: TaskDecisionDraft[] | undefined | null,
): TaskDecision[] | undefined {
  if (!Array.isArray(drafts)) return undefined
  const decisions = drafts.reduce<TaskDecision[]>((acc, draft) => {
    const id = draft.id.trim()
    const transitionId = draft.transitionId.trim()
    if (!id || !transitionId) return acc
    const label = applyEditedTaskText(draft.labelSource, draft.label) ?? id
    acc.push({ id, label, transitionId, ...(draft.style ? { style: draft.style } : {}) })
    return acc
  }, [])
  return decisions.length > 0 ? decisions : undefined
}

export function newDecisionDraft(transitionId = ''): TaskDecisionDraft {
  return { key: nextDraftKey('decision'), id: generateDecisionId(), label: '', transitionId, style: '' }
}

export function newEntityBindingDraft(): TaskEntityBindingDraft {
  return { key: nextDraftKey('binding'), entityType: '', idPath: '', label: '' }
}

export interface TaskDeadlinePersistence {
  deadline?: TaskDeadline
  slaDuration?: string
}

/**
 * Which key the edited deadline is written back to.
 *
 * `deadline` is the business-word superset and `slaDuration` the original bare
 * form, and 1.1 declared that the bare form keeps working forever. So the
 * inspector edits whichever key the config already carries and NEVER migrates
 * one to the other: a definition authored before this section keeps saving the
 * shape an older engine can read, and a definition that already declares a
 * `deadline` keeps it.
 */
export function resolveTaskDeadlinePersistence(
  config: Pick<UserTaskConfig, 'deadline' | 'slaDuration'>,
  edited: string,
): TaskDeadlinePersistence {
  const duration = edited.trim()
  if (!duration) return {}
  if (config.deadline) {
    return { deadline: config.deadline.duration === duration ? config.deadline : { duration } }
  }
  return { slaDuration: duration }
}

/** The duration the deadline control opens with, whichever key carries it. */
export function readTaskDeadlineDraft(config: Pick<UserTaskConfig, 'deadline' | 'slaDuration'>): string {
  const duration = config.deadline?.duration ?? config.slaDuration
  return typeof duration === 'string' ? duration : ''
}
