/**
 * Workflows Module - Parallel Fork / Join Handler
 *
 * Implements PARALLEL_FORK / PARALLEL_JOIN execution with a multi-token model:
 *
 *  - `openFork` turns a PARALLEL_FORK step into N persistent branch tokens
 *    (`WorkflowBranchInstance`), one per outgoing `auto` transition, and puts the
 *    instance into the dormant `FORKED` state.
 *  - `advanceBranches` runs the interleaved loop: while the instance is FORKED it
 *    advances each ACTIVE branch one step at a time (BPMN semantics — single lock,
 *    no thread-level concurrency). A branch pauses independently (USER_TASK /
 *    signal / timer / async activity) without blocking siblings.
 *  - When every branch has reached its JOIN (wait-all), `fireJoin` merges the
 *    branch namespaces back into `instance.context`, applies optional
 *    `outputMapping`, and resumes the root token at the step after the JOIN.
 *  - A failed branch cancels its siblings and fails the whole instance.
 *
 * All work happens under the executor's pessimistic instance lock + transaction,
 * so wait-all counting and JOIN firing are race-free.
 */

import { EntityManager, LockMode } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import {
  WorkflowInstance,
  WorkflowBranchInstance,
  WorkflowDefinition,
  StepInstance,
  UserTask,
  WorkflowEvent,
} from '../data/entities'
import { logWorkflowEvent } from './event-logger'
import * as stepHandler from './step-handler'
import { branchToken } from './execution-token'

export interface AdvanceBranchesResult {
  outcome: 'joined' | 'waiting' | 'failed'
  error?: string
}

export interface ResumeBranchOptions {
  instanceId: string
  branchInstanceId: string
  tenantId: string
  organizationId: string
  /** Values merged into the branch's private namespace before resuming (task form data, signal payload, …). */
  contextMerge?: Record<string, any>
  /** Step instance to exit (the paused step's instance) before the branch advances past it. */
  exitStepInstanceId?: string | null
  exitOutput?: any
}

/**
 * Resume a single paused/waiting branch: optionally merge data into its
 * namespace, exit its paused step instance, and mark it ACTIVE. The caller then
 * re-enters `executeWorkflow` (FORKED mode) so the interleaved loop advances the
 * branch and, if it is the last to arrive, fires the JOIN.
 *
 * Idempotent: a re-delivered signal/timer/task on an already-ACTIVE or terminal
 * branch is a no-op. Returns false when there is nothing to resume.
 */
export async function resumeBranch(
  em: EntityManager,
  options: ResumeBranchOptions,
): Promise<boolean> {
  const branch = await em.findOne(WorkflowBranchInstance, {
    id: options.branchInstanceId,
    workflowInstanceId: options.instanceId,
    tenantId: options.tenantId,
    organizationId: options.organizationId,
  })

  if (!branch) return false
  if (branch.status !== 'PAUSED' && branch.status !== 'WAITING_FOR_ACTIVITIES') {
    // Already active or terminal — re-delivery; nothing to do.
    return false
  }

  const now = new Date()
  if (options.contextMerge) {
    branch.contextNamespace = { ...(branch.contextNamespace || {}), ...options.contextMerge }
  }

  if (options.exitStepInstanceId) {
    const stepInstance = await em.findOne(StepInstance, {
      id: options.exitStepInstanceId,
      workflowInstanceId: options.instanceId,
      status: 'ACTIVE',
    })
    if (stepInstance) {
      await stepHandler.exitStep(em, stepInstance, options.exitOutput)
    }
  }

  branch.status = 'ACTIVE'
  branch.pendingTransition = null
  branch.updatedAt = now
  await em.flush()

  return true
}

interface ParallelContext {
  userId?: string
}

function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => (current == null ? undefined : current[key]), obj)
}

/**
 * Open a PARALLEL_FORK: create one ACTIVE branch per outgoing `auto` transition
 * and mark the instance FORKED. Branch tokens start positioned ON the fork step
 * so the interleaved loop runs each branch's fork transition (and its
 * activities) in that branch's own context.
 */
export async function openFork(
  em: EntityManager,
  instance: WorkflowInstance,
  definition: WorkflowDefinition,
  forkStepDef: any,
): Promise<void> {
  const forkStepId: string = forkStepDef.stepId
  const joinStepId: string | undefined = forkStepDef.config?.joinStepId
  if (!joinStepId) {
    throw new Error(`[internal] PARALLEL_FORK "${forkStepId}" missing config.joinStepId`)
  }

  const outgoing = (definition.definition.transitions || []).filter(
    (transition: any) => transition.fromStepId === forkStepId && transition.trigger === 'auto',
  )

  const now = new Date()
  const branchKeys: string[] = []
  for (const transition of outgoing) {
    branchKeys.push(transition.transitionId)
    const branch = em.create(WorkflowBranchInstance, {
      workflowInstanceId: instance.id,
      forkStepId,
      joinStepId,
      branchKey: transition.transitionId,
      parentBranchId: null,
      // Start ON the fork; advanceBranches runs the branch_key transition first.
      currentStepId: forkStepId,
      status: 'ACTIVE',
      contextNamespace: {},
      tenantId: instance.tenantId,
      organizationId: instance.organizationId,
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(branch)
  }

  instance.status = 'FORKED'
  instance.activeForkStepId = forkStepId
  instance.updatedAt = now
  await em.flush()

  await logWorkflowEvent(em, {
    workflowInstanceId: instance.id,
    eventType: 'PARALLEL_FORK_OPENED',
    eventData: { forkStepId, joinStepId, branchKeys },
    tenantId: instance.tenantId,
    organizationId: instance.organizationId,
  })
}

/**
 * Resume a branch that was WAITING_FOR_ACTIVITIES after its async activities
 * finished. Mirrors the instance-level resume but scoped to the branch:
 * merges completed-activity outputs into the branch namespace, advances the
 * branch's pending transition target, and marks it ACTIVE (or FAILED if any
 * async activity failed). The caller re-enters the interleaved loop.
 */
export async function resumeBranchAfterActivities(
  em: EntityManager,
  container: AwilixContainer,
  instanceId: string,
  branchInstanceId: string,
): Promise<{ continueExecution: boolean }> {
  const branch = await em.findOne(
    WorkflowBranchInstance,
    { id: branchInstanceId, workflowInstanceId: instanceId },
    { lockMode: LockMode.PESSIMISTIC_WRITE },
  )
  if (!branch) {
    throw new Error('[internal] Branch not found during async resume')
  }
  if (branch.status !== 'WAITING_FOR_ACTIVITIES') {
    // Re-delivery or already advanced — nothing to do.
    return { continueExecution: false }
  }

  const namespace = branch.contextNamespace || {}
  const pendingJobIds = (namespace._pendingAsyncActivities as any[]) || []

  const completedEvents = await em.find(WorkflowEvent, {
    workflowInstanceId: instanceId,
    branchInstanceId,
    eventType: 'ACTIVITY_COMPLETED',
    eventData: { async: true },
  })
  const failedCount = await em.count(WorkflowEvent, {
    workflowInstanceId: instanceId,
    branchInstanceId,
    eventType: 'ACTIVITY_FAILED',
    eventData: { async: true },
  })

  if (completedEvents.length + failedCount < pendingJobIds.length) {
    // Still waiting on other branch activities.
    return { continueExecution: false }
  }

  const now = new Date()
  if (failedCount > 0) {
    branch.status = 'FAILED'
    branch.errorMessage = `${failedCount} async activities failed in branch "${branch.branchKey}"`
    branch.updatedAt = now
    await em.flush()
    // The interleaved loop will observe the FAILED branch and cancel siblings.
    return { continueExecution: true }
  }

  const mergedNamespace: Record<string, any> = { ...namespace }
  for (const event of completedEvents) {
    if (event.eventData?.output) {
      mergedNamespace[`${event.eventData.activityId}_result`] = event.eventData.output
    }
  }
  delete mergedNamespace._pendingAsyncActivities
  branch.contextNamespace = mergedNamespace

  const pending = branch.pendingTransition
  branch.pendingTransition = null
  branch.status = 'ACTIVE'
  branch.updatedAt = now
  await em.flush()

  // Execute the destination step in branch context (mirrors the instance-level
  // resume) so the branch cursor lands on an executed step. The step may pause
  // the branch again (e.g. a following USER_TASK); that is handled by the loop.
  if (pending) {
    const instance = await em.findOne(WorkflowInstance, { id: instanceId })
    if (instance) {
      branch.currentStepId = pending.toStepId
      await em.flush()
      await stepHandler.executeStep(
        em,
        instance,
        pending.toStepId,
        { workflowContext: { ...(instance.context || {}), ...(branch.contextNamespace || {}) } },
        container,
        branch,
      )
    }
  }

  return { continueExecution: true }
}

/**
 * Interleaved branch execution loop. Advances ACTIVE branches one step at a
 * time until either all branches reach the JOIN (→ fireJoin → 'joined'), a
 * branch fails (→ cancel siblings + 'failed'), or no branch is ACTIVE because
 * they are all waiting on external resume (→ 'waiting').
 */
export async function advanceBranches(
  em: EntityManager,
  container: AwilixContainer,
  instance: WorkflowInstance,
  definition: WorkflowDefinition,
  context: ParallelContext,
): Promise<AdvanceBranchesResult> {
  const forkStepId = instance.activeForkStepId
  if (!forkStepId) {
    throw new Error('[internal] advanceBranches called but instance has no active fork')
  }

  // Branch-aware iteration budget: each branch gets the same per-token budget as
  // the single-token loop, so fan-out alone never trips the guard.
  const allBranchesForBudget = await em.find(WorkflowBranchInstance, {
    workflowInstanceId: instance.id,
    forkStepId,
  })
  const maxIterations = Math.max(1, allBranchesForBudget.length) * 100
  let iterations = 0

  while (iterations < maxIterations) {
    iterations++

    const branches = await em.find(WorkflowBranchInstance, {
      workflowInstanceId: instance.id,
      forkStepId,
    })

    const active = branches.filter((b) => b.status === 'ACTIVE')

    if (active.length === 0) {
      const failed = branches.find((b) => b.status === 'FAILED')
      if (failed) {
        // A branch failed out-of-band (e.g. async-activity resume marked it
        // FAILED); cancel any non-terminal siblings before failing the instance.
        await cancelSiblings(em, instance, failed)
        return { outcome: 'failed', error: failed.errorMessage || 'Branch failed' }
      }
      if (branches.every((b) => b.status === 'COMPLETED')) {
        await fireJoin(em, instance, definition, branches, forkStepId)
        return { outcome: 'joined' }
      }
      // Some branches paused/waiting for external resume — instance idles.
      return { outcome: 'waiting' }
    }

    for (const branch of active) {
      const result = await advanceOneBranch(em, container, instance, definition, branch, context)
      if (result === 'failed') {
        await cancelSiblings(em, instance, branch)
        return { outcome: 'failed', error: branch.errorMessage || 'Branch failed' }
      }
    }
  }

  throw new Error('[internal] Maximum branch execution iterations reached - possible infinite loop')
}

/**
 * Advance a single ACTIVE branch by one step. Returns 'failed' if the branch
 * failed; otherwise mutates branch state (advanced / completed@join / paused).
 */
async function advanceOneBranch(
  em: EntityManager,
  container: AwilixContainer,
  instance: WorkflowInstance,
  definition: WorkflowDefinition,
  branch: WorkflowBranchInstance,
  context: ParallelContext,
): Promise<'advanced' | 'failed'> {
  // Already at the join → synchronize (mark completed, do not execute the join).
  if (branch.currentStepId === branch.joinStepId) {
    await completeBranchAtJoin(em, instance, branch)
    return 'advanced'
  }

  const transitionHandler = await import('./transition-handler')

  const token = branchToken(instance, branch)
  // Token read context = instance snapshot overlaid with branch namespace.
  const readContext = { ...(instance.context || {}), ...(branch.contextNamespace || {}) }
  const evalContext = { workflowContext: readContext, userId: context.userId }

  // Select the transition to take. Branches positioned on the fork follow their
  // own branch_key transition; otherwise pick the highest-priority valid auto one.
  let selected: any | null = null
  if (branch.currentStepId === branch.forkStepId) {
    selected = (definition.definition.transitions || []).find(
      (transition: any) => transition.transitionId === branch.branchKey,
    ) || null
  } else {
    const valid = await transitionHandler.findValidTransitions(
      em,
      instance,
      branch.currentStepId,
      evalContext,
    )
    const validAuto = valid.filter((vt) => vt.isValid && vt.transition?.trigger === 'auto')
    selected = validAuto.length > 0 ? validAuto[0].transition : null
  }

  if (!selected) {
    // No outgoing transition and not at the join → the branch is stuck.
    await failBranch(em, instance, branch, `Branch "${branch.branchKey}" has no valid transition from "${branch.currentStepId}"`)
    return 'failed'
  }

  try {
    const transitionResult = await transitionHandler.executeTransitionForToken(
      em,
      container,
      token,
      selected.fromStepId,
      selected.toStepId,
      evalContext,
    )

    if (!transitionResult.success) {
      await failBranch(em, instance, branch, transitionResult.error || 'Branch transition failed')
      return 'failed'
    }

    // executeTransitionForToken set branch.currentStepId = toStepId. If that is
    // the join, synchronize now (the join step itself is a no-op).
    if (branch.currentStepId === branch.joinStepId) {
      await completeBranchAtJoin(em, instance, branch)
    }
    return 'advanced'
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await failBranch(em, instance, branch, message)
    return 'failed'
  }
}

async function completeBranchAtJoin(
  em: EntityManager,
  instance: WorkflowInstance,
  branch: WorkflowBranchInstance,
): Promise<void> {
  const now = new Date()
  branch.status = 'COMPLETED'
  branch.completedAt = now
  branch.updatedAt = now
  await em.flush()

  await logWorkflowEvent(em, {
    workflowInstanceId: instance.id,
    branchInstanceId: branch.id,
    eventType: 'PARALLEL_BRANCH_COMPLETED',
    eventData: { branchKey: branch.branchKey, joinStepId: branch.joinStepId },
    tenantId: instance.tenantId,
    organizationId: instance.organizationId,
  })
}

async function failBranch(
  em: EntityManager,
  instance: WorkflowInstance,
  branch: WorkflowBranchInstance,
  message: string,
): Promise<void> {
  const now = new Date()
  branch.status = 'FAILED'
  branch.errorMessage = message
  branch.updatedAt = now
  await em.flush()

  await logWorkflowEvent(em, {
    workflowInstanceId: instance.id,
    branchInstanceId: branch.id,
    eventType: 'PARALLEL_BRANCH_FAILED',
    eventData: { branchKey: branch.branchKey, error: message },
    tenantId: instance.tenantId,
    organizationId: instance.organizationId,
  })
}

/**
 * Cancel sibling branches of a failed branch (best-effort), cancel their open
 * user tasks, and log a cancellation event per branch.
 */
async function cancelSiblings(
  em: EntityManager,
  instance: WorkflowInstance,
  failedBranch: WorkflowBranchInstance,
): Promise<void> {
  const siblings = await em.find(WorkflowBranchInstance, {
    workflowInstanceId: instance.id,
    forkStepId: failedBranch.forkStepId,
  })

  const now = new Date()
  for (const sibling of siblings) {
    if (sibling.id === failedBranch.id) continue
    if (sibling.status === 'ACTIVE' || sibling.status === 'PAUSED' || sibling.status === 'WAITING_FOR_ACTIVITIES') {
      sibling.status = 'CANCELLED'
      sibling.updatedAt = now

      // Best-effort: cancel the branch's open user tasks.
      const openTasks = await em.find(UserTask, {
        workflowInstanceId: instance.id,
        branchInstanceId: sibling.id,
        status: 'PENDING',
      })
      for (const task of openTasks) {
        task.status = 'CANCELLED'
        task.updatedAt = now
      }

      await em.flush()

      await logWorkflowEvent(em, {
        workflowInstanceId: instance.id,
        branchInstanceId: sibling.id,
        eventType: 'PARALLEL_BRANCH_CANCELLED',
        eventData: { branchKey: sibling.branchKey, reason: 'sibling-failed' },
        tenantId: instance.tenantId,
        organizationId: instance.organizationId,
      })
    }
  }

  await logWorkflowEvent(em, {
    workflowInstanceId: instance.id,
    eventType: 'PARALLEL_FORK_FAILED',
    eventData: { forkStepId: failedBranch.forkStepId, failedBranchKey: failedBranch.branchKey },
    tenantId: instance.tenantId,
    organizationId: instance.organizationId,
  })
}

/**
 * Fire the JOIN once all branches are COMPLETED: merge each branch namespace
 * under `instance.context.branches[branchKey]`, apply optional outputMapping to
 * lift selected values to the top level, then resume the root token at the step
 * after the JOIN.
 */
async function fireJoin(
  em: EntityManager,
  instance: WorkflowInstance,
  definition: WorkflowDefinition,
  branches: WorkflowBranchInstance[],
  forkStepId: string,
): Promise<void> {
  const joinStepId = branches[0]?.joinStepId
  if (!joinStepId) {
    throw new Error('[internal] fireJoin called without a join step id')
  }

  const joinStep = definition.definition.steps.find((s: any) => s.stepId === joinStepId)

  // Deterministic merge — no silent collisions: each branch keeps its own slot.
  const branchesContext: Record<string, any> = { ...(instance.context?.branches || {}) }
  const mergedBranchKeys: string[] = []
  for (const branch of branches) {
    branchesContext[branch.branchKey] = branch.contextNamespace || {}
    mergedBranchKeys.push(branch.branchKey)
  }

  let nextContext: Record<string, any> = {
    ...(instance.context || {}),
    branches: branchesContext,
  }

  // Optional outputMapping: topLevelKey -> 'branches.<branchKey>.<path>'. The
  // reserved `branches` slot map is never overwritten — guard it explicitly so a
  // mapping cannot clobber the per-branch namespaces.
  const outputMapping: Record<string, string> | undefined = joinStep?.config?.outputMapping
  if (outputMapping) {
    for (const [topKey, sourcePath] of Object.entries(outputMapping)) {
      if (topKey === 'branches') continue
      const value = getNestedValue(nextContext, sourcePath)
      if (value !== undefined) nextContext[topKey] = value
    }
  }

  // Park the root token ON the JOIN step (not its successor) and let the
  // single-token executor loop run the JOIN's outgoing transition. Jumping
  // straight to the post-join step would bypass stepHandler.executeStep() for
  // that step — so a following USER_TASK / WAIT_FOR_TIMER / WAIT_FOR_SIGNAL would
  // never have its task created / timer enqueued / signal wait registered (the
  // instance would hang), and any activities on the JOIN's outgoing transition
  // would be skipped. The JOIN step itself is a no-op, so the loop simply runs
  // its outgoing transition through the normal step-entry path.
  const afterJoinStepId = (definition.definition.transitions || []).find(
    (transition: any) => transition.fromStepId === joinStepId,
  )?.toStepId ?? null

  const now = new Date()
  instance.context = nextContext
  instance.status = 'RUNNING'
  instance.activeForkStepId = null
  instance.currentStepId = joinStepId
  instance.updatedAt = now
  await em.flush()

  await logWorkflowEvent(em, {
    workflowInstanceId: instance.id,
    eventType: 'PARALLEL_JOIN_COMPLETED',
    eventData: { forkStepId, joinStepId, mergedBranchKeys, afterJoinStepId },
    tenantId: instance.tenantId,
    organizationId: instance.organizationId,
  })
}
