export type XrayDraftStepSummary = {
  stepId: string
  stepName: string
  stepType: string
  updates: Array<{ commandId: string; inputKeys: string[] }>
}

export type XrayDraftTriggerSummary = {
  eventPattern: string
  conditions: number
}

export type XrayDraftSummary = {
  workflowId: string
  workflowName: string
  enabled: boolean
  lifecycle: string | null
  steps: XrayDraftStepSummary[]
  triggers: XrayDraftTriggerSummary[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

const RECORD_ID_TEMPLATE = /^\{\{\s*context\./

function summarizeStep(step: Record<string, unknown>): XrayDraftStepSummary {
  const updates = records(step.activities)
    .filter((activity) => activity.activityType === 'UPDATE_ENTITY' && isRecord(activity.config))
    .map((activity) => {
      const config = activity.config as Record<string, unknown>
      const input = isRecord(config.input) ? config.input : {}
      const inputKeys = Object.entries(input)
        .filter(([, value]) => !(typeof value === 'string' && RECORD_ID_TEMPLATE.test(value)))
        .map(([key]) => key)
      return { commandId: text(config.commandId), inputKeys }
    })
  return { stepId: text(step.stepId), stepName: text(step.stepName), stepType: text(step.stepType), updates }
}

/**
 * What a generated draft definition does, read defensively from the payload the X-Ray draft
 * endpoints return (the payload itself is posted unchanged to the workflows API): its id and
 * name, that it is created disabled, its event triggers and its automated update steps.
 */
export function summarizeDraftPayload(payload: unknown): XrayDraftSummary | null {
  if (!isRecord(payload)) return null
  const definition = isRecord(payload.definition) ? payload.definition : {}
  const workflowId = text(payload.workflowId)
  if (!workflowId) return null
  return {
    workflowId,
    workflowName: text(payload.workflowName) || workflowId,
    enabled: payload.enabled === true,
    lifecycle: typeof payload.lifecycle === 'string' ? payload.lifecycle : null,
    steps: records(definition.steps).map(summarizeStep).filter((step) => step.stepType !== 'START' && step.stepType !== 'END'),
    triggers: records(definition.triggers).map((trigger) => ({
      eventPattern: text(trigger.eventPattern),
      conditions: isRecord(trigger.config) && Array.isArray(trigger.config.filterConditions) ? trigger.config.filterConditions.length : 0,
    })),
  }
}

/** The id of the definition created by `POST /api/workflows/definitions` (`{ data: { id } }`). */
export function readCreatedDefinitionId(body: unknown): string | null {
  if (!isRecord(body)) return null
  const data = isRecord(body.data) ? body.data : body
  return typeof data.id === 'string' && data.id.length > 0 ? data.id : null
}

export const XRAY_WORKFLOW_ID_PATTERN = /^[a-z0-9._-]{1,100}$/
