import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { z } from 'zod'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { WorkflowDefinition } from '../data/entities'
import {
  createWorkflowDefinitionInputCheckedSchema,
  type activityDefinitionSchema,
  type CreateWorkflowDefinitionApiInput,
} from '../data/validators'
import { getWorkflowSafeCommand } from './workflow-safe-commands'

export const WORKFLOW_DRAFT_SERVICE_KEY = 'workflowDraftService'

export const WORKFLOW_DRAFT_FORBIDDEN_ACTIVITY_TYPES = ['CALL_API', 'CALL_WEBHOOK', 'CALL_OPEN_MERCATO'] as const

export type WorkflowDraftScope = { tenantId: string; organizationId: string }

export type WorkflowDraftIssueCode =
  | 'invalid_definition'
  | 'must_be_disabled'
  | 'must_be_draft'
  | 'kind_not_allowed'
  | 'grant_not_allowed'
  | 'credential_activity'
  | 'command_not_workflow_safe'

export type WorkflowDraftIssue = { path: string; code: WorkflowDraftIssueCode; message: string }

export type WorkflowDraftCommand = { commandId: string; requiredFeatures: string[] }

export type WorkflowDraftValidationResult =
  | {
      ok: true
      payload: CreateWorkflowDefinitionApiInput
      commands: WorkflowDraftCommand[]
      workflowIdAvailable: boolean
    }
  | { ok: false; issues: WorkflowDraftIssue[] }

export type WorkflowDefinitionShape = {
  id: string
  workflowId: string
  version: number
  enabled: boolean
  steps: Array<{ stepId: string; stepType: string }>
  transitions: Array<{ fromStepId: string; toStepId: string; kind: string | null }>
}

/**
 * Lets another module propose a workflow definition without the workflows
 * module giving up control of what may be generated. `validateDraftDefinition`
 * persists nothing: it applies the `POST /api/workflows/definitions` schema plus
 * the draft policy (disabled, `lifecycle: 'draft'`, plain workflow, no execution
 * grant, no credential-bearing activity, only catalogued workflow-safe
 * UPDATE_ENTITY commands). `getDefinitionForScope` exposes only the graph
 * structure of a stored definition, never its config, activities or metadata.
 */
export interface WorkflowDraftService {
  validateDraftDefinition(payload: unknown, scope: WorkflowDraftScope): Promise<WorkflowDraftValidationResult>
  getDefinitionForScope(id: string, scope: WorkflowDraftScope): Promise<WorkflowDefinitionShape | null>
}

type DraftActivity = z.infer<typeof activityDefinitionSchema>

type DraftActivityLocation = { path: string; activity: DraftActivity }

const guidSchema = z.guid()

const forbiddenActivityTypes = new Set<string>(WORKFLOW_DRAFT_FORBIDDEN_ACTIVITY_TYPES)

function isGuid(value: unknown): value is string {
  return guidSchema.safeParse(value).success
}

function isCredentialActivityType(activityType: string): boolean {
  return forbiddenActivityTypes.has(activityType) || activityType.toUpperCase().includes('WEBHOOK')
}

function formatIssuePath(path: ReadonlyArray<PropertyKey>): string {
  return path.map((segment) => String(segment)).join('.')
}

function collectActivityLocations(definition: CreateWorkflowDefinitionApiInput['definition']): DraftActivityLocation[] {
  const locations: DraftActivityLocation[] = []
  for (const [stepIndex, step] of definition.steps.entries()) {
    for (const [activityIndex, activity] of (step.activities ?? []).entries()) {
      locations.push({ path: `definition.steps.${stepIndex}.activities.${activityIndex}`, activity })
    }
  }
  for (const [transitionIndex, transition] of definition.transitions.entries()) {
    for (const [activityIndex, activity] of (transition.activities ?? []).entries()) {
      locations.push({ path: `definition.transitions.${transitionIndex}.activities.${activityIndex}`, activity })
    }
  }
  return locations
}

function collectPolicyIssues(payload: CreateWorkflowDefinitionApiInput): WorkflowDraftIssue[] {
  const issues: WorkflowDraftIssue[] = []
  if (payload.enabled !== false) {
    issues.push({ path: 'enabled', code: 'must_be_disabled', message: 'A draft definition must be submitted with enabled: false' })
  }
  if (payload.lifecycle !== 'draft') {
    issues.push({ path: 'lifecycle', code: 'must_be_draft', message: 'A draft definition must be submitted with lifecycle: draft' })
  }
  if (payload.kind !== undefined && payload.kind !== 'workflow') {
    issues.push({ path: 'kind', code: 'kind_not_allowed', message: 'A draft definition must be a plain workflow, not a component' })
  }
  if ((payload.grantedFeatures?.length ?? 0) > 0) {
    issues.push({ path: 'grantedFeatures', code: 'grant_not_allowed', message: 'A draft definition cannot carry an execution grant' })
  }
  return issues
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function toStepShapes(steps: unknown): WorkflowDefinitionShape['steps'] {
  if (!Array.isArray(steps)) return []
  const shapes: WorkflowDefinitionShape['steps'] = []
  for (const entry of steps) {
    const step = readRecord(entry)
    const stepId = readNonEmptyString(step?.stepId)
    const stepType = readNonEmptyString(step?.stepType)
    if (stepId && stepType) shapes.push({ stepId, stepType })
  }
  return shapes
}

function toTransitionShapes(transitions: unknown): WorkflowDefinitionShape['transitions'] {
  if (!Array.isArray(transitions)) return []
  const shapes: WorkflowDefinitionShape['transitions'] = []
  for (const entry of transitions) {
    const transition = readRecord(entry)
    const fromStepId = readNonEmptyString(transition?.fromStepId)
    const toStepId = readNonEmptyString(transition?.toStepId)
    if (fromStepId && toStepId) {
      shapes.push({ fromStepId, toStepId, kind: readNonEmptyString(transition?.kind) })
    }
  }
  return shapes
}

export function createWorkflowDraftService(container: AwilixContainer): WorkflowDraftService {
  const forkEntityManager = (): EntityManager => container.resolve<EntityManager>('em').fork()

  return {
    async validateDraftDefinition(payload, scope) {
      const parsed = createWorkflowDefinitionInputCheckedSchema.safeParse(payload)
      if (!parsed.success) {
        return {
          ok: false,
          issues: parsed.error.issues.map((issue) => ({
            path: formatIssuePath(issue.path),
            code: 'invalid_definition' as const,
            message: issue.message,
          })),
        }
      }

      const input = parsed.data
      const issues = collectPolicyIssues(input)
      const commands = new Map<string, WorkflowDraftCommand>()

      for (const { path, activity } of collectActivityLocations(input.definition)) {
        if (isCredentialActivityType(activity.activityType)) {
          issues.push({
            path: `${path}.activityType`,
            code: 'credential_activity',
            message: `Activity type ${activity.activityType} is credential-bearing and cannot be generated`,
          })
        }
        if (activity.activityType !== 'UPDATE_ENTITY') continue
        const command = getWorkflowSafeCommand(activity.config.commandId)
        if (!command) {
          issues.push({
            path: `${path}.config.commandId`,
            code: 'command_not_workflow_safe',
            message: 'UPDATE_ENTITY command is not a catalogued workflow-safe command',
          })
          continue
        }
        commands.set(command.commandId, {
          commandId: command.commandId,
          requiredFeatures: [...command.requiredFeatures],
        })
      }

      if (issues.length > 0) return { ok: false, issues }

      const takenCount = await forkEntityManager().count(WorkflowDefinition, {
        workflowId: input.workflowId,
        tenantId: scope.tenantId,
      })

      return {
        ok: true,
        payload: input,
        commands: Array.from(commands.values()).sort((left, right) => left.commandId.localeCompare(right.commandId)),
        workflowIdAvailable: takenCount === 0,
      }
    },

    async getDefinitionForScope(id, scope) {
      if (!isGuid(id) || !isGuid(scope.tenantId) || !isGuid(scope.organizationId)) return null
      const record = await findOneWithDecryption(
        forkEntityManager(),
        WorkflowDefinition,
        {
          id,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          deletedAt: null,
        },
        undefined,
        { tenantId: scope.tenantId, organizationId: scope.organizationId },
      )
      if (!record) return null
      if (record.tenantId !== scope.tenantId || record.organizationId !== scope.organizationId || record.deletedAt) {
        return null
      }
      const definition = readRecord(record.definition)
      return {
        id: record.id,
        workflowId: record.workflowId,
        version: record.version,
        enabled: record.enabled,
        steps: toStepShapes(definition?.steps),
        transitions: toTransitionShapes(definition?.transitions),
      }
    },
  }
}
