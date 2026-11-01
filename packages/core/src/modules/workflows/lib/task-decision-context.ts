/**
 * Re-resolving a task's decision buttons from its instance's pinned definition.
 *
 * Separated from the pure `lib/task-decisions.ts` because it needs the ORM: the
 * task surfaces (a client page, a record-page widget) import the pure half, and
 * only the server imports this one.
 */

import type { EntityManager } from '@mikro-orm/core'
import { StepInstance, WorkflowInstance } from '../data/entities'
import type { UserTask } from '../data/entities'
import { findDefinitionForInstance } from './find-definition'
import { readAuthoredTaskDecisions } from './task-decisions'
import { resolveTaskDecisions } from './task-resolution'
import type { ResolvedTaskDecision, TaskInterpolate } from './task-resolution'

export type TaskDecisionContext = {
  stepId: string | null
  decisions: ResolvedTaskDecision[]
  /**
   * Authored `userTaskConfig.formKey`, resolved the same way the decisions are:
   * from the instance's PINNED definition, never from a column. A task form is
   * a rendering choice, so re-reading it per request is what lets a definition
   * that gains a renderer key start using it — and it needs no migration.
   */
  formKey: string | null
}

/** Trusted tenant/organization, taken from the already scope-checked task row. */
export type TaskDecisionContextScope = {
  tenantId: string
  organizationId: string
}

export const EMPTY_TASK_DECISION_CONTEXT: TaskDecisionContext = {
  stepId: null,
  decisions: [],
  formKey: null,
}

/**
 * Re-resolve a task's decision buttons from its instance's pinned definition.
 *
 * Degrades to an empty list at every step — a task whose instance, step or
 * definition has gone missing still completes through the plain form, which is
 * exactly how every task behaved before decisions existed.
 *
 * With `scope`, every read carries the task's tenant and organization, so a
 * reference into another scope resolves to nothing instead of supplying its
 * step, form key or decisions.
 */
export async function loadTaskDecisionContext(
  em: EntityManager,
  task: Pick<UserTask, 'workflowInstanceId' | 'stepInstanceId'>,
  scope?: TaskDecisionContextScope,
): Promise<TaskDecisionContext> {
  const scopeWhere = scope ? { tenantId: scope.tenantId, organizationId: scope.organizationId } : {}
  const instance = await em.findOne(WorkflowInstance, { id: task.workflowInstanceId, ...scopeWhere })
  if (!instance) return EMPTY_TASK_DECISION_CONTEXT

  const stepInstance = await em.findOne(StepInstance, { id: task.stepInstanceId, ...scopeWhere })
  if (!stepInstance) return EMPTY_TASK_DECISION_CONTEXT

  const resolvedDefinition = await findDefinitionForInstance(em, instance)
  const definition =
    resolvedDefinition && scope && resolvedDefinition.tenantId !== scope.tenantId ? null : resolvedDefinition
  if (!definition) return { stepId: stepInstance.stepId, decisions: [], formKey: null }

  const formKey = readAuthoredTaskFormKey(definition.definition, stepInstance.stepId)
  const authored = readAuthoredTaskDecisions(definition.definition, stepInstance.stepId)
  if (!authored.length) return { stepId: stepInstance.stepId, decisions: [], formKey }

  const { interpolateVariables } = await import('./activity-executor')
  const interpolate: TaskInterpolate = (value) =>
    interpolateVariables(value, instance.context ?? {}, instance)

  return {
    stepId: stepInstance.stepId,
    decisions: resolveTaskDecisions(authored, interpolate),
    formKey,
  }
}

function readAuthoredTaskFormKey(definition: unknown, stepId: string): string | null {
  const steps = (definition as { steps?: { stepId?: string; userTaskConfig?: { formKey?: unknown } }[] })
    ?.steps
  const step = (steps ?? []).find((candidate) => candidate.stepId === stepId)
  const formKey = step?.userTaskConfig?.formKey
  return typeof formKey === 'string' && formKey.length > 0 ? formKey : null
}
