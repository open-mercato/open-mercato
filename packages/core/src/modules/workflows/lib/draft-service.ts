import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { z } from 'zod'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { WorkflowDefinition } from '../data/entities'
import {
  createWorkflowDefinitionInputCheckedSchema,
  type activityDefinitionSchema,
  type CreateWorkflowDefinitionApiInput,
} from '../data/validators'
import { getWorkflowSafeCommand, type WorkflowSafeCommandDefinition } from './workflow-safe-commands'
import { isWorkflowCommandEnabled } from './workflow-command-enablement'
import { resolveWorkflowCommandPolicyForContainer } from './workflow-command-settings'
import { getAllCodeWorkflows } from './code-registry'

export const WORKFLOW_DRAFT_SERVICE_KEY = 'workflowDraftService'

export const WORKFLOW_DRAFT_FORBIDDEN_ACTIVITY_TYPES = ['CALL_API', 'CALL_WEBHOOK', 'CALL_OPEN_MERCATO'] as const

/**
 * The only activity types a generated draft may contain (an allowlist): catalogued
 * UPDATE_ENTITY commands plus the side-effect-free WAIT and SET_VARIABLE. Every other type
 * (SEND_EMAIL, EMIT_EVENT, EXECUTE_FUNCTION, INVOKE_AGENT, extension types, anything added
 * later) is refused as `activity_not_allowed`; credential-bearing ones as `credential_activity`.
 */
export const WORKFLOW_DRAFT_ALLOWED_ACTIVITY_TYPES = ['UPDATE_ENTITY', 'WAIT', 'SET_VARIABLE'] as const

export type WorkflowDraftScope = { tenantId: string; organizationId: string }

export type WorkflowDraftIssueCode =
  | 'invalid_definition'
  | 'must_be_disabled'
  | 'must_be_draft'
  | 'kind_not_allowed'
  | 'grant_not_allowed'
  | 'credential_activity'
  | 'activity_not_allowed'
  | 'command_not_workflow_safe'

export type WorkflowDraftIssue = { path: string; code: WorkflowDraftIssueCode; message: string }

/**
 * A command a draft would run: its declared features and whether the tenant switched it on
 * (tier 2, `workflow-command-enablement`). A draft with a command that is not enabled is still
 * valid (it is created disabled), but its runs fail until an administrator enables the command.
 */
export type WorkflowDraftCommand = { commandId: string; requiredFeatures: string[]; enabled: boolean }

export type WorkflowDraftValidationResult =
  | {
      ok: true
      payload: CreateWorkflowDefinitionApiInput
      commands: WorkflowDraftCommand[]
      workflowIdAvailable: boolean
    }
  | { ok: false; issues: WorkflowDraftIssue[] }

/**
 * One UPDATE_ENTITY activity of a workflow that an enabled event trigger starts and that can run:
 * its command is catalogued and enabled for the tenant (a disabled command fails every run, so it
 * automates nothing). The trigger's event pattern, the command and the input keys it sets (values
 * are never exposed).
 */
export type WorkflowAutomatedUpdate = {
  workflowDefinitionId: string
  workflowId: string
  eventPattern: string
  commandId: string
  inputKeys: string[]
}

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
 * grant, only allowlisted activity types — catalogued workflow-safe
 * UPDATE_ENTITY commands, WAIT, SET_VARIABLE — and never a credential-bearing
 * one). `getDefinitionForScope` exposes only the graph structure of a stored
 * definition, never its config, activities or metadata. `listAutomatedUpdates`
 * lists what the enabled event triggers of a tenant + organization already
 * automate (event pattern, UPDATE_ENTITY command and input keys, never values),
 * resolved exactly like the trigger runtime (legacy, embedded and code triggers).
 */
export interface WorkflowDraftService {
  validateDraftDefinition(payload: unknown, scope: WorkflowDraftScope): Promise<WorkflowDraftValidationResult>
  getDefinitionForScope(id: string, scope: WorkflowDraftScope): Promise<WorkflowDefinitionShape | null>
  listAutomatedUpdates(scope: WorkflowDraftScope): Promise<WorkflowAutomatedUpdate[]>
}

type DraftActivity = z.infer<typeof activityDefinitionSchema>

type DraftActivityLocation = { path: string; activity: DraftActivity }

const guidSchema = z.guid()

const forbiddenActivityTypes = new Set<string>(WORKFLOW_DRAFT_FORBIDDEN_ACTIVITY_TYPES)

const allowedActivityTypes = new Set<string>(WORKFLOW_DRAFT_ALLOWED_ACTIVITY_TYPES)

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

type RawActivity = { activityType: string; config: Record<string, unknown> | null }

function readActivities(container: Record<string, unknown> | null): RawActivity[] {
  const activities = container?.activities
  if (!Array.isArray(activities)) return []
  const result: RawActivity[] = []
  for (const entry of activities) {
    const activity = readRecord(entry)
    const activityType = readNonEmptyString(activity?.activityType)
    if (activityType) result.push({ activityType, config: readRecord(activity?.config) })
  }
  return result
}

/** UPDATE_ENTITY activities (command + input keys) of a stored or code definition's steps and transitions. */
export function collectUpdateEntityActivities(definition: unknown): Array<{ commandId: string; inputKeys: string[] }> {
  const root = readRecord(definition)
  const containers = [
    ...(Array.isArray(root?.steps) ? root.steps : []),
    ...(Array.isArray(root?.transitions) ? root.transitions : []),
  ].map(readRecord)
  const updates: Array<{ commandId: string; inputKeys: string[] }> = []
  for (const container of containers) {
    for (const activity of readActivities(container)) {
      if (activity.activityType !== 'UPDATE_ENTITY') continue
      const commandId = readNonEmptyString(activity.config?.commandId)
      const input = readRecord(activity.config?.input)
      if (!commandId || !input) continue
      updates.push({ commandId, inputKeys: Object.keys(input).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)) })
    }
  }
  return updates
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
      const commands = new Map<string, WorkflowSafeCommandDefinition>()

      for (const { path, activity } of collectActivityLocations(input.definition)) {
        if (isCredentialActivityType(activity.activityType)) {
          issues.push({
            path: `${path}.activityType`,
            code: 'credential_activity',
            message: `Activity type ${activity.activityType} is credential-bearing and cannot be generated`,
          })
          continue
        }
        if (!allowedActivityTypes.has(activity.activityType)) {
          issues.push({
            path: `${path}.activityType`,
            code: 'activity_not_allowed',
            message: `Activity type ${activity.activityType} cannot be generated in a draft`,
          })
          continue
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
        commands.set(command.commandId, command)
      }

      if (issues.length > 0) return { ok: false, issues }

      const takenCount = await forkEntityManager().count(WorkflowDefinition, {
        workflowId: input.workflowId,
        tenantId: scope.tenantId,
      })
      const policy = await resolveWorkflowCommandPolicyForContainer(container, scope.tenantId)

      return {
        ok: true,
        payload: input,
        commands: Array.from(commands.values())
          .map((command) => ({
            commandId: command.commandId,
            requiredFeatures: [...command.requiredFeatures],
            enabled: isWorkflowCommandEnabled(command, policy),
          }))
          .sort((left, right) => left.commandId.localeCompare(right.commandId)),
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

    async listAutomatedUpdates(scope) {
      if (!isGuid(scope.tenantId) || !isGuid(scope.organizationId)) return []
      const em = forkEntityManager()
      const { loadTriggersForTenant } = await import('./event-trigger-service')
      const triggers = await loadTriggersForTenant(em, scope.tenantId, scope.organizationId)
      const storedIds = Array.from(new Set(triggers.filter((trigger) => trigger.source !== 'code').map((trigger) => trigger.workflowDefinitionId)))
      const stored = storedIds.length > 0
        ? await findWithDecryption(
          em,
          WorkflowDefinition,
          { id: { $in: storedIds }, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
          undefined,
          { tenantId: scope.tenantId, organizationId: scope.organizationId },
        )
        : []
      const definitions = new Map<string, unknown>()
      for (const record of stored) {
        if (record.tenantId === scope.tenantId && record.organizationId === scope.organizationId && !record.deletedAt) {
          definitions.set(record.id, record.definition)
        }
      }
      const codeDefinitions = new Map(getAllCodeWorkflows().map((workflow) => [workflow.workflowId, workflow.definition as unknown]))
      const policy = await resolveWorkflowCommandPolicyForContainer(container, scope.tenantId)
      const runs = (commandId: string): boolean => {
        const command = getWorkflowSafeCommand(commandId)
        return command !== null && isWorkflowCommandEnabled(command, policy)
      }
      const automated: WorkflowAutomatedUpdate[] = []
      for (const trigger of triggers) {
        if (!trigger.enabled) continue
        const definition = trigger.source === 'code'
          ? codeDefinitions.get(trigger.workflowId)
          : definitions.get(trigger.workflowDefinitionId)
        if (definition === undefined) continue
        for (const update of collectUpdateEntityActivities(definition)) {
          if (!runs(update.commandId)) continue
          automated.push({
            workflowDefinitionId: trigger.workflowDefinitionId,
            workflowId: trigger.workflowId,
            eventPattern: trigger.eventPattern,
            commandId: update.commandId,
            inputKeys: update.inputKeys,
          })
        }
      }
      return automated
    },
  }
}
