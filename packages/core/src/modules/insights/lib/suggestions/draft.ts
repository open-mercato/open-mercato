import { createHash } from 'node:crypto'
import { matchEventPattern } from '@open-mercato/shared/lib/events/patterns'
import { DEFAULT_CRUD_PAYLOAD_SCHEMA, getDeclaredEvents } from '@open-mercato/shared/modules/events'
import type { RegisteredProcess } from '../process/registry'
import type { MinedCondition, MinedFollowup, MinedTrigger } from './mine'
import type { XraySuggestionNotDraftableReason } from './constants'

export const XRAY_SUGGESTION_RECORD_ID_CONTEXT_KEY = 'recordId'

export const XRAY_SUGGESTION_TRIGGER_ID = 'xray_suggestion'

const RECORD_ID_PAYLOAD_PATH = 'id'

const WORKFLOW_ID_MAX_LENGTH = 100

const NAME_MAX_LENGTH = 255

const DESCRIPTION_MAX_LENGTH = 2000

export type SuggestionProcess = Pick<RegisteredProcess, 'processKey' | 'resourceKind' | 'milestones' | 'automation'>

/** The rule a suggestion stands for (what the draft and the draftability checks need). */
export type SuggestionRule = {
  processKey: string
  signatureHash: string
  trigger: MinedTrigger
  condition: MinedCondition | null
  followups: ReadonlyArray<Pick<MinedFollowup, 'field' | 'value'>>
}

/** Declared payload paths of an event, or `null` when no module declares the event. */
export type SuggestionEventCatalog = {
  payloadPaths: (eventId: string) => ReadonlySet<string> | null
}

const CRUD_EVENT_SUFFIXES = ['.created', '.updated', '.deleted'] as const

function moduleOfEvent(eventId: string): string {
  const separator = eventId.indexOf('.')
  return separator < 0 ? eventId : eventId.slice(0, separator)
}

/**
 * The event catalog of this process: declared events (`createModuleEvents`) with their declared
 * payload fields (`payloadSchema`; platform CRUD events get the generated default `id`,
 * `organizationId`, `tenantId`, `syncOrigin`); an event without a declared schema carries no known
 * path. Only the app registers every module's event declarations; a CLI / worker process knows
 * the events of the modules whose `events.ts` happened to be imported. A module declares all its
 * events at once, so when no event of an event's module is known here, the platform CRUD
 * convention applies (a `<resource>.created|updated|deleted` event carries exactly the generated
 * default payload); when the module's events are known, an event missing from them is undeclared.
 * The draft route runs in the app, so it always decides against the declared events.
 */
export function createDeclaredEventCatalog(): SuggestionEventCatalog {
  const declared = getDeclaredEvents()
  const events = new Map(declared.map((event) => [event.id, event]))
  const modulesWithEvents = new Set(declared.map((event) => event.module ?? moduleOfEvent(event.id)))
  const crudPaths = new Set(DEFAULT_CRUD_PAYLOAD_SCHEMA.fields.map((field) => field.path))
  return {
    payloadPaths(eventId) {
      const event = events.get(eventId)
      if (event) return event.excludeFromTriggers === true ? null : new Set((event.payloadSchema?.fields ?? []).map((field) => field.path))
      if (modulesWithEvents.has(moduleOfEvent(eventId))) return null
      return CRUD_EVENT_SUFFIXES.some((suffix) => eventId.endsWith(suffix)) ? crudPaths : null
    },
  }
}

/** A workflow event trigger that expresses a suggestion's trigger and condition. */
export type SuggestionTriggerExpression = {
  eventId: string
  filterConditions: Array<{ field: string; operator: 'eq'; value: string }>
  recordIdPath: string
}

export type SuggestionTriggerAssessment =
  | { ok: true; expression: SuggestionTriggerExpression }
  | { ok: false; reason: Extract<XraySuggestionNotDraftableReason, 'trigger_not_expressible' | 'condition_not_expressible'> }

/**
 * Whether a workflow event trigger can express the suggestion's trigger and condition. Only the
 * creation of the case root is expressible: its `<resourceKind>.created` event must be declared
 * and carry the record id. A field change cannot be told apart from a later update that keeps
 * the value (events carry no transition), and the platform CRUD events carry ids only
 * (`{ id, organizationId, tenantId }`), so stage, follow-up and milestone triggers are not
 * expressible. A condition is expressible only when the event declares a payload field at the
 * condition's field key (an `eq` filter).
 */
export function assessSuggestionTrigger(
  process: Pick<SuggestionProcess, 'resourceKind'>,
  rule: Pick<SuggestionRule, 'trigger' | 'condition'>,
  catalog: SuggestionEventCatalog,
): SuggestionTriggerAssessment {
  if (rule.trigger.activityKind !== 'lifecycle' || rule.trigger.activityKey !== 'created') return { ok: false, reason: 'trigger_not_expressible' }
  const eventId = `${process.resourceKind}.created`
  const paths = catalog.payloadPaths(eventId)
  if (!paths || !paths.has(RECORD_ID_PAYLOAD_PATH)) return { ok: false, reason: 'trigger_not_expressible' }
  const filterConditions: SuggestionTriggerExpression['filterConditions'] = []
  if (rule.condition) {
    if (!paths.has(rule.condition.field)) return { ok: false, reason: 'condition_not_expressible' }
    filterConditions.push({ field: rule.condition.field, operator: 'eq', value: rule.condition.value })
  }
  return { ok: true, expression: { eventId, filterConditions, recordIdPath: RECORD_ID_PAYLOAD_PATH } }
}

/**
 * Events a workflow trigger would listen to for this suggestion's trigger: the case root's
 * `created` / `updated` event, or the milestone resource's `created` / `deleted` / `updated` event.
 */
export function candidateTriggerEvents(process: Pick<SuggestionProcess, 'resourceKind' | 'milestones'>, trigger: MinedTrigger): string[] {
  if (trigger.activityKind === 'lifecycle') return trigger.activityKey === 'created' ? [`${process.resourceKind}.created`] : []
  if (trigger.activityKind === 'stage' || trigger.activityKind === 'followup') return [`${process.resourceKind}.updated`]
  if (trigger.activityKind !== 'milestone') return []
  const milestone = process.milestones.find((candidate) => trigger.activityKey.startsWith(`${candidate.key}.`) || trigger.activityKey.startsWith(`${candidate.key}:`))
  if (!milestone) return []
  if (trigger.field === null) {
    const action = trigger.activityKey.slice(milestone.key.length + 1)
    return action === 'created' || action === 'deleted' ? [`${milestone.resourceKind}.${action}`] : []
  }
  return [`${milestone.resourceKind}.updated`]
}

export type AutomatedUpdate = {
  eventPattern: string
  commandId: string
  inputKeys: readonly string[]
}

/**
 * "Already automated": an enabled workflow event trigger listening to the suggestion's trigger
 * event already runs an UPDATE_ENTITY of the process's update command setting the follow-up's
 * field. Without declared automation hints the command is unknown, so nothing matches.
 */
export function isAlreadyAutomated(process: SuggestionProcess, rule: Pick<SuggestionRule, 'trigger' | 'followups'>, automated: readonly AutomatedUpdate[]): boolean {
  const automation = process.automation
  if (!automation || automated.length === 0) return false
  const events = candidateTriggerEvents(process, rule.trigger)
  if (events.length === 0) return false
  return rule.followups.every((followup) => {
    const inputKey = automation.fieldInputKeys[followup.field]
    if (!inputKey) return false
    return automated.some((entry) => entry.commandId === automation.updateCommandId
      && entry.inputKeys.includes(inputKey)
      && events.some((eventId) => matchEventPattern(eventId, entry.eventPattern)))
  })
}

/** Workflow id of a suggestion draft: `xray.s.<processKey>.<12 signature chars>` (a digest of the process key when too long). */
export function suggestionWorkflowId(processKey: string, signatureHash: string): string {
  const readable = `xray.s.${processKey}.${signatureHash.slice(0, 12)}`
  if (readable.length <= WORKFLOW_ID_MAX_LENGTH) return readable
  return `xray.s.${createHash('sha256').update(processKey).digest('hex').slice(0, 16)}.${signatureHash.slice(0, 12)}`
}

export type SuggestionDraftLabels = {
  workflowName: string
  description: string
  triggerName: string
  start: string
  end: string
  recordId: string
  stepName: (fieldKey: string, value: string) => string
}

function bounded(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value
}

function stepIdOf(fieldKey: string, position: number): string {
  return `set_${fieldKey.toLowerCase().replace(/[^a-z0-9_]/g, '_')}_${position}`
}

/**
 * The suggestion as a DISABLED draft workflow definition (`enabled: false`, `lifecycle: 'draft'`,
 * nothing persisted): an event trigger on the expressed event (the condition as an `eq` filter,
 * the record id mapped into `{{context.recordId}}`), then one AUTOMATED step per follow-up with a
 * single UPDATE_ENTITY activity of the process's declared update command setting the field (its
 * declared input key) to the observed value. Only UPDATE_ENTITY is generated (never a
 * credential-bearing or side-effecting activity). `null` when the process declares no update
 * command (`no_command`). Values are projection identifiers, never free text.
 */
export function buildSuggestionWorkflowDraft(input: {
  process: SuggestionProcess
  rule: SuggestionRule
  expression: SuggestionTriggerExpression
  labels: SuggestionDraftLabels
  workflowId?: string
}): Record<string, unknown> | null {
  const automation = input.process.automation
  if (!automation) return null
  const steps: Array<Record<string, unknown>> = []
  for (const followup of input.rule.followups) {
    const inputKey = automation.fieldInputKeys[followup.field]
    if (!inputKey) return null
    const stepId = stepIdOf(followup.field, steps.length + 1)
    const stepName = bounded(input.labels.stepName(followup.field, followup.value), NAME_MAX_LENGTH)
    steps.push({
      stepId,
      stepName,
      stepType: 'AUTOMATED',
      activities: [{
        activityId: stepId,
        activityName: stepName,
        activityType: 'UPDATE_ENTITY',
        config: {
          commandId: automation.updateCommandId,
          input: { [automation.recordIdInputKey]: `{{context.${XRAY_SUGGESTION_RECORD_ID_CONTEXT_KEY}}}`, [inputKey]: followup.value },
        },
      }],
    })
  }
  if (steps.length === 0) return null
  const chain = ['start', ...steps.map((step) => String(step.stepId)), 'end']
  const transitions = chain.slice(1).map((toStepId, index) => ({
    transitionId: `to_${toStepId}`,
    fromStepId: chain[index],
    toStepId,
    trigger: 'auto',
  }))
  const triggerConfig: Record<string, unknown> = {
    contextMapping: [{ targetKey: XRAY_SUGGESTION_RECORD_ID_CONTEXT_KEY, sourceExpression: input.expression.recordIdPath }],
  }
  if (input.expression.filterConditions.length > 0) triggerConfig.filterConditions = input.expression.filterConditions
  return {
    workflowId: input.workflowId ?? suggestionWorkflowId(input.rule.processKey, input.rule.signatureHash),
    workflowName: bounded(input.labels.workflowName, NAME_MAX_LENGTH),
    description: bounded(input.labels.description, DESCRIPTION_MAX_LENGTH),
    version: 1,
    enabled: false,
    kind: 'workflow',
    lifecycle: 'draft',
    metadata: { tags: ['process-xray', 'process-xray-suggestion'] },
    definition: {
      steps: [
        { stepId: 'start', stepName: bounded(input.labels.start, NAME_MAX_LENGTH), stepType: 'START' },
        ...steps,
        { stepId: 'end', stepName: bounded(input.labels.end, NAME_MAX_LENGTH), stepType: 'END' },
      ],
      transitions,
      triggers: [{
        triggerId: XRAY_SUGGESTION_TRIGGER_ID,
        name: bounded(input.labels.triggerName, NAME_MAX_LENGTH),
        eventPattern: input.expression.eventId,
        config: triggerConfig,
        enabled: true,
        priority: 0,
      }],
      contextSchema: {
        input: {
          fields: [{ name: XRAY_SUGGESTION_RECORD_ID_CONTEXT_KEY, type: 'text', label: input.labels.recordId, required: true }],
        },
      },
    },
  }
}

export type DraftValidationIssue = { path: string; code: string }

/**
 * Maps a failed workflows validation of a suggestion draft to a not-draftable reason: a command
 * outside the workflow-safe catalogue is `command_not_workflow_safe`, anything else `draft_invalid`.
 */
export function reasonOfDraftIssues(issues: readonly DraftValidationIssue[]): Extract<XraySuggestionNotDraftableReason, 'command_not_workflow_safe' | 'draft_invalid'> {
  return issues.length > 0 && issues.every((issue) => issue.code === 'command_not_workflow_safe') ? 'command_not_workflow_safe' : 'draft_invalid'
}
