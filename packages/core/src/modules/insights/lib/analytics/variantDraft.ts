import { createHash } from 'node:crypto'
import { PROCESS_NONE_VALUE, PROCESS_OTHER_VALUE } from '@open-mercato/shared/modules/insights/process'
import type { RegisteredProcess } from '../process/registry'

export const XRAY_DRAFT_RECORD_ID_CONTEXT_KEY = 'recordId'

export const XRAY_DRAFT_DEFAULT_RECORD_ID_INPUT_KEY = 'id'

const WORKFLOW_ID_MAX_LENGTH = 100

const NAME_MAX_LENGTH = 255

const UNEXPRESSIBLE_VALUES = new Set<string>([PROCESS_OTHER_VALUE, PROCESS_NONE_VALUE])

export type VariantDraftLabels = {
  workflowName: string
  description: string
  start: string
  end: string
  recordId: string
  stepName: (fieldKey: string, value: string) => string
}

export type VariantDraftInput = {
  process: Pick<RegisteredProcess, 'processKey' | 'stageFields'>
  variantHash: string
  activityKeys: readonly string[]
  commandId: string
  recordIdInputKey?: string
  inputKeys?: Readonly<Record<string, string>>
  workflowId?: string
  workflowName?: string
  labels: VariantDraftLabels
}

export type VariantDraft = {
  payload: Record<string, unknown>
  activityStepMap: Record<string, string>
  skippedActivities: string[]
}

function bounded(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value
}

/**
 * Default workflow id of a variant draft: `xray.<processKey>.<first 12 hash chars>`, or a digest
 * of the process key when that would exceed the 100-character limit.
 */
export function defaultDraftWorkflowId(processKey: string, variantHash: string): string {
  const readable = `xray.${processKey}.${variantHash.slice(0, 12)}`
  if (readable.length <= WORKFLOW_ID_MAX_LENGTH) return readable
  return `xray.${createHash('sha256').update(processKey).digest('hex').slice(0, 16)}.${variantHash.slice(0, 12)}`
}

function stepIdOf(fieldKey: string, position: number): string {
  return `set_${fieldKey.toLowerCase().replace(/[^a-z0-9_]/g, '_')}_${position}`
}

/**
 * The variant as a DISABLED draft workflow definition (`enabled: false`, `lifecycle: 'draft'`,
 * nothing persisted): START, then one AUTOMATED step per stage activity of the variant in order,
 * each running a single UPDATE_ENTITY activity of the given command that sets the stage field
 * (`input[inputKey]`, the field key unless mapped) to the observed value on the record in
 * `{{context.recordId}}` (declared as the definition's only context input), then END. Activities
 * that cannot be expressed as an update of the case root are skipped and reported: lifecycle
 * steps, follow-ups (their values are pseudonyms), milestones, exits and the `other` / `none`
 * placeholders. Returns `null` when no stage activity remains. Values are projection identifiers
 * (validated activity values or UUIDs), never free text.
 */
export function buildVariantWorkflowDraft(input: VariantDraftInput): VariantDraft | null {
  const recordIdInputKey = input.recordIdInputKey ?? XRAY_DRAFT_DEFAULT_RECORD_ID_INPUT_KEY
  const fields = input.process.stageFields
  const steps: Array<Record<string, unknown>> = []
  const activityStepMap: Record<string, string> = {}
  const skipped: string[] = []
  for (const activityKey of input.activityKeys) {
    const field = fields.find((candidate) => activityKey.startsWith(`${candidate.key}:`))
    const value = field ? activityKey.slice(field.key.length + 1) : ''
    if (!field || value.length === 0 || UNEXPRESSIBLE_VALUES.has(value)) {
      if (!skipped.includes(activityKey)) skipped.push(activityKey)
      continue
    }
    const stepId = stepIdOf(field.key, steps.length + 1)
    const stepName = bounded(input.labels.stepName(field.key, value), NAME_MAX_LENGTH)
    const inputKey = input.inputKeys?.[field.key] ?? field.key
    steps.push({
      stepId,
      stepName,
      stepType: 'AUTOMATED',
      activities: [{
        activityId: stepId,
        activityName: stepName,
        activityType: 'UPDATE_ENTITY',
        config: {
          commandId: input.commandId,
          input: { [recordIdInputKey]: `{{context.${XRAY_DRAFT_RECORD_ID_CONTEXT_KEY}}}`, [inputKey]: value },
        },
      }],
    })
    if (!Object.prototype.hasOwnProperty.call(activityStepMap, activityKey)) activityStepMap[activityKey] = stepId
  }
  if (steps.length === 0) return null
  const chain = ['start', ...steps.map((step) => String(step.stepId)), 'end']
  const transitions = chain.slice(1).map((toStepId, index) => ({
    transitionId: `to_${toStepId}`,
    fromStepId: chain[index],
    toStepId,
    trigger: 'auto',
  }))
  const payload: Record<string, unknown> = {
    workflowId: input.workflowId ?? defaultDraftWorkflowId(input.process.processKey, input.variantHash),
    workflowName: bounded(input.workflowName ?? input.labels.workflowName, NAME_MAX_LENGTH),
    description: bounded(input.labels.description, 2000),
    version: 1,
    enabled: false,
    kind: 'workflow',
    lifecycle: 'draft',
    metadata: { tags: ['process-xray'] },
    definition: {
      steps: [
        { stepId: 'start', stepName: bounded(input.labels.start, NAME_MAX_LENGTH), stepType: 'START' },
        ...steps,
        { stepId: 'end', stepName: bounded(input.labels.end, NAME_MAX_LENGTH), stepType: 'END' },
      ],
      transitions,
      contextSchema: {
        input: {
          fields: [{ name: XRAY_DRAFT_RECORD_ID_CONTEXT_KEY, type: 'text', label: input.labels.recordId, required: true }],
        },
      },
    },
  }
  return { payload, activityStepMap, skippedActivities: skipped }
}
