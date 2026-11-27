/**
 * Workflows Module - Task completion guards
 *
 * A host module that owns a precondition for finishing a task ("the related
 * record must be signed first") registers a guard here. The registry is
 * consulted INSIDE `completeUserTask`, so the HTTP route, the
 * `workflows.tasks.complete` command behind the notification quick action and
 * every in-process `taskHandler` caller are covered by one check, and it is
 * evaluated non-mutatingly by the task detail route so `canComplete` never
 * offers a completion the handler would refuse.
 *
 * Modelled on the CRUD mutation-guard registry
 * (`@open-mercato/shared/lib/crud/mutation-guard-registry`), but keyed on what a
 * task is — its workflow, step and form key — rather than on an entity kind.
 *
 * Spec: `.ai/specs/2026-10-11-workflows-task-completion-guards.md`.
 */

import type { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { TranslateWithFallbackFn } from '@open-mercato/shared/lib/i18n/translate'
import { WorkflowInstance } from '../data/entities'
import type { UserTask } from '../data/entities'
import { loadTaskDecisionContext } from './task-decision-context'

const logger = createLogger('workflows')

/** Code a guard veto falls back to when the guard names none. */
export const TASK_COMPLETION_BLOCKED_CODE = 'TASK_COMPLETION_BLOCKED'

/** Code a guard that threw (or answered garbage) blocks with — fail closed. */
export const TASK_COMPLETION_GUARD_FAILED_CODE = 'COMPLETION_GUARD_FAILED'

export const TASK_COMPLETION_GUARD_DEFAULT_PRIORITY = 50

/**
 * `complete` runs inside `completeUserTask` right before the task is mutated;
 * `preview` runs on read surfaces to decide `canComplete`. A guard MUST be
 * read-only in both — it decides, it never writes.
 */
export type TaskCompletionGuardMode = 'complete' | 'preview'

export type TaskCompletionGuardTaskSnapshot = {
  id: string
  workflowInstanceId: string
  stepInstanceId: string
  taskName: string
  status: string
  assignedTo: string | null
  assignedToRoles: readonly string[] | null
  claimedBy: string | null
  entityBindings: readonly unknown[]
}

export type TaskCompletionGuardTarget = {
  workflowId: string | null
  workflowInstanceId: string
  stepId: string | null
  formKey: string | null
}

export type TaskCompletionGuardInput = TaskCompletionGuardTarget & {
  mode: TaskCompletionGuardMode
  /** Trusted scope, read from the already tenant-scoped task row. */
  tenantId: string
  organizationId: string
  /** Who is completing (complete) or who is looking (preview). */
  userId: string | null
  task: TaskCompletionGuardTaskSnapshot
  /** Submitted form payload — `complete` mode only. */
  formData: Readonly<Record<string, unknown>> | null
  /** Pressed decision — `complete` mode only. */
  decisionId: string | null
  /** For host reads. In `preview` mode this is a fork that is never flushed. */
  em: EntityManager
  container: AwilixContainer
}

export type TaskCompletionGuardResult =
  | { ok: true }
  | {
      ok: false
      /** Machine code returned as the 409 body's `code`. */
      code: string
      /** i18n key a UI renders instead of the generic sentence. */
      messageKey?: string
      /** Plain-language fallback for API callers. */
      message?: string
    }

export type TaskCompletionGuard = {
  /** Unique, namespaced: `<module>.<guard>`. */
  id: string
  /** Omitted = every workflow. */
  workflowId?: string | readonly string[]
  /** Omitted = every step. */
  stepId?: string | readonly string[]
  /** Task-level key (`userTaskConfig.formKey`). Omitted = any. */
  formKey?: string | readonly string[]
  /** Lower runs first. Default 50. */
  priority?: number
  evaluate(
    input: TaskCompletionGuardInput,
  ): Promise<TaskCompletionGuardResult> | TaskCompletionGuardResult
}

/** What a veto looks like to every caller, whichever guard produced it. */
export type TaskCompletionBlock = {
  guardId: string
  code: string
  messageKey: string | null
  message: string | null
}

export type TaskCompletionGuardEntry = {
  moduleId: string
  guard: TaskCompletionGuard
}

const GLOBAL_TASK_COMPLETION_GUARDS_KEY = '__openMercatoWorkflowTaskCompletionGuards__'

let localEntries: TaskCompletionGuardEntry[] | null = null

function readGlobalEntries(): TaskCompletionGuardEntry[] | null {
  try {
    const value = (globalThis as Record<string, unknown>)[GLOBAL_TASK_COMPLETION_GUARDS_KEY]
    return Array.isArray(value) ? (value as TaskCompletionGuardEntry[]) : null
  } catch {
    return null
  }
}

function writeGlobalEntries(entries: TaskCompletionGuardEntry[]): void {
  try {
    ;(globalThis as Record<string, unknown>)[GLOBAL_TASK_COMPLETION_GUARDS_KEY] = entries
  } catch {
    // ignore global assignment failures
  }
}

/**
 * Register (or re-register) one module's completion guards.
 *
 * Additive across modules, replacing within a module — the same contract as
 * `registerWorkInboxSources` — so each module registers from its own `di.ts`
 * and load order between modules is irrelevant.
 */
export function registerTaskCompletionGuards(
  entries: Array<{ moduleId: string; guards: TaskCompletionGuard[] }>,
): void {
  const replacedModuleIds = new Set(entries.map((entry) => entry.moduleId))
  const kept = getTaskCompletionGuards().filter((entry) => !replacedModuleIds.has(entry.moduleId))
  const added: TaskCompletionGuardEntry[] = []
  for (const entry of entries) {
    for (const guard of entry.guards) {
      added.push({ moduleId: entry.moduleId, guard })
    }
  }
  const merged = [...kept, ...added]
  localEntries = merged
  writeGlobalEntries(merged)
}

export function getTaskCompletionGuards(): TaskCompletionGuardEntry[] {
  const globalEntries = readGlobalEntries()
  if (globalEntries) return globalEntries
  return localEntries ?? []
}

/** Test seam — drops every registration so a suite starts from a known set. */
export function clearTaskCompletionGuards(): void {
  localEntries = []
  writeGlobalEntries([])
}

function selectorMatches(
  selector: string | readonly string[] | undefined,
  value: string | null,
): boolean {
  if (selector === undefined) return true
  if (value === null) return false
  return typeof selector === 'string' ? selector === value : selector.includes(value)
}

/** PURE: does this guard apply to the task's workflow, step and form key? */
export function taskCompletionGuardApplies(
  guard: TaskCompletionGuard,
  target: TaskCompletionGuardTarget,
): boolean {
  return (
    selectorMatches(guard.workflowId, target.workflowId) &&
    selectorMatches(guard.stepId, target.stepId) &&
    selectorMatches(guard.formKey, target.formKey)
  )
}

function snapshotTask(task: UserTask): TaskCompletionGuardTaskSnapshot {
  return {
    id: task.id,
    workflowInstanceId: task.workflowInstanceId,
    stepInstanceId: task.stepInstanceId,
    taskName: task.taskName,
    status: task.status,
    assignedTo: task.assignedTo ?? null,
    assignedToRoles: task.assignedToRoles ? [...task.assignedToRoles] : null,
    claimedBy: task.claimedBy ?? null,
    entityBindings: Array.isArray(task.entityBindings) ? [...task.entityBindings] : [],
  }
}

/**
 * Resolve what the guards select on, from the instance's PINNED definition —
 * the same source the decision buttons and the form key come from.
 *
 * Every read is scoped to the task's own tenant and organization: an instance
 * or step outside that scope resolves to nothing, so it can never supply the
 * workflow, step or form key a guard selects on.
 */
export async function loadTaskCompletionGuardTarget(
  em: EntityManager,
  task: Pick<UserTask, 'workflowInstanceId' | 'stepInstanceId' | 'tenantId' | 'organizationId'>,
): Promise<TaskCompletionGuardTarget> {
  const scope = { tenantId: task.tenantId, organizationId: task.organizationId }
  const instance = await em.findOne(WorkflowInstance, { id: task.workflowInstanceId, ...scope })
  const { stepId, formKey } = instance
    ? await loadTaskDecisionContext(em, task, scope)
    : { stepId: null, formKey: null }
  return {
    workflowId: instance?.workflowId ?? null,
    workflowInstanceId: task.workflowInstanceId,
    stepId,
    formKey,
  }
}

function toBlock(guard: TaskCompletionGuard, result: unknown): TaskCompletionBlock | null {
  if (result && typeof result === 'object' && (result as { ok?: unknown }).ok === true) return null
  const veto = (result && typeof result === 'object' ? result : {}) as Record<string, unknown>
  const code = typeof veto.code === 'string' && veto.code.length > 0 ? veto.code : TASK_COMPLETION_BLOCKED_CODE
  return {
    guardId: guard.id,
    code,
    messageKey: typeof veto.messageKey === 'string' && veto.messageKey.length > 0 ? veto.messageKey : null,
    message: typeof veto.message === 'string' && veto.message.length > 0 ? veto.message : null,
  }
}

/** Telemetry fingerprint for a guard that threw (see the error-reporting policy). */
export const TASK_COMPLETION_GUARD_FAILED_REPORT_CODE = 'workflows.task_completion_guard_failed'

function reportTaskCompletionGuardFailure(
  error: unknown,
  guard: TaskCompletionGuard,
  task: UserTask,
  mode: TaskCompletionGuardMode,
): void {
  try {
    getTelemetryRuntime()?.reportError(error, {
      module: 'workflows',
      code: TASK_COMPLETION_GUARD_FAILED_REPORT_CODE,
      attributes: {
        guardId: guard.id,
        taskId: task.id,
        mode,
        tenantId: task.tenantId,
        organizationId: task.organizationId,
      },
    })
  } catch (reportFailure) {
    logger.warn('Task completion guard failure could not be reported', {
      component: 'task-completion-guards',
      guardId: guard.id,
      err: reportFailure,
    })
  }
}

export type EvaluateTaskCompletionGuardsOptions = {
  mode: TaskCompletionGuardMode
  userId: string | null
  formData?: Record<string, unknown> | null
  decisionId?: string | null
  /** Pre-resolved target, when the caller already loaded it. */
  target?: TaskCompletionGuardTarget
}

/**
 * Run every applicable guard and return the first veto, or `null` to allow.
 *
 * Fail closed: a guard that throws, or answers anything but `{ ok: true }`,
 * blocks. With no guard registered this returns before touching the database,
 * which is what keeps unguarded completions byte-identical to before.
 */
export async function evaluateTaskCompletionGuards(
  em: EntityManager,
  container: AwilixContainer,
  task: UserTask,
  options: EvaluateTaskCompletionGuardsOptions,
): Promise<TaskCompletionBlock | null> {
  const registered = getTaskCompletionGuards()
  if (registered.length === 0) return null

  const target = options.target ?? (await loadTaskCompletionGuardTarget(em, task))
  const applicable = registered
    .map((entry) => entry.guard)
    .filter((guard) => taskCompletionGuardApplies(guard, target))
    .sort(
      (left, right) =>
        (left.priority ?? TASK_COMPLETION_GUARD_DEFAULT_PRIORITY) -
        (right.priority ?? TASK_COMPLETION_GUARD_DEFAULT_PRIORITY),
    )
  if (applicable.length === 0) return null

  const guardEm = options.mode === 'preview' ? em.fork() : em
  const input: TaskCompletionGuardInput = {
    ...target,
    mode: options.mode,
    tenantId: task.tenantId,
    organizationId: task.organizationId,
    userId: options.userId,
    task: snapshotTask(task),
    formData: options.mode === 'complete' ? { ...(options.formData ?? {}) } : null,
    decisionId: options.mode === 'complete' ? options.decisionId ?? null : null,
    em: guardEm,
    container,
  }

  for (const guard of applicable) {
    let result: unknown
    try {
      result = await guard.evaluate(input)
    } catch (error) {
      logger.error('Task completion guard failed; blocking completion', {
        component: 'task-completion-guards',
        guardId: guard.id,
        taskId: task.id,
        err: error,
      })
      reportTaskCompletionGuardFailure(error, guard, task, options.mode)
      return {
        guardId: guard.id,
        code: TASK_COMPLETION_GUARD_FAILED_CODE,
        messageKey: null,
        message: null,
      }
    }
    const block = toBlock(guard, result)
    if (block) return block
  }
  return null
}

/** i18n key of the generic refusal, used when the guard names no message. */
export const TASK_COMPLETION_BLOCKED_MESSAGE_KEY = 'workflows.tasks.errors.completionBlocked'

const TASK_COMPLETION_BLOCKED_FALLBACK_MESSAGE = 'Task completion is blocked by a precondition'

/**
 * The 409 body every completion path answers a veto with.
 *
 * With `translate`, `error` is localized: the guard's `messageKey` when the
 * dictionary knows it, else the guard's plain `message`, else the generic
 * refusal. Without it the body is the untranslated English fallback.
 */
export function buildTaskCompletionBlockedBody(
  block: TaskCompletionBlock,
  translate?: TranslateWithFallbackFn,
): Record<string, unknown> {
  const generic = translate
    ? translate(TASK_COMPLETION_BLOCKED_MESSAGE_KEY, TASK_COMPLETION_BLOCKED_FALLBACK_MESSAGE)
    : TASK_COMPLETION_BLOCKED_FALLBACK_MESSAGE
  const fallback = block.message ?? generic
  return {
    error: translate && block.messageKey ? translate(block.messageKey, fallback) : fallback,
    code: block.code,
    guardId: block.guardId,
    messageKey: block.messageKey,
  }
}

/**
 * `buildTaskCompletionBlockedBody` in the caller's locale — what the HTTP routes
 * and the `workflows.tasks.complete` command answer a veto with.
 */
export async function resolveTaskCompletionBlockedBody(
  block: TaskCompletionBlock,
): Promise<Record<string, unknown>> {
  try {
    const { resolveTranslations } = await import('@open-mercato/shared/lib/i18n/server')
    const { translate } = await resolveTranslations()
    return buildTaskCompletionBlockedBody(block, translate)
  } catch (error) {
    try {
      getTelemetryRuntime()?.reportError(error, {
        module: 'workflows',
        code: 'workflows.task_completion_blocked_translation_failed',
        attributes: { guardId: block.guardId },
      })
    } catch {
      // the untranslated body below is still a correct refusal
    }
    return buildTaskCompletionBlockedBody(block)
  }
}

export const TASK_COMPLETION_BLOCKED_ERROR_NAME = 'TaskCompletionBlockedError'

/** What `TaskCompletionBlockedError` (`lib/task-handler.ts`) exposes to callers. */
export type TaskCompletionBlockedErrorLike = Error & {
  code: string
  status: number
  block: TaskCompletionBlock
  body: Record<string, unknown>
}

/**
 * Structural check, so routes recognise a veto without value-importing
 * `lib/task-handler` (module rule #1) and so the class surviving bundle
 * duplication does not matter.
 */
export function isTaskCompletionBlockedError(error: unknown): error is TaskCompletionBlockedErrorLike {
  if (!(error instanceof Error) || error.name !== TASK_COMPLETION_BLOCKED_ERROR_NAME) return false
  const block = (error as { block?: unknown }).block
  return typeof block === 'object' && block !== null
}
