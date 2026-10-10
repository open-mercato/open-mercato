export type WorkflowEditorValues = Record<string, unknown>

export type TriggerBacktestEditorChange = {
  version: number
  enabled: boolean
  triggers: unknown[]
}

export type TriggerBacktestGroupDescription = {
  triggerId: string
  eventId: string | null
  name: string | null
  eventPattern: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/**
 * The trigger backtest proposal of the CURRENT workflow editor data (the editor's
 * `workflows.definition.editor:*` injection data, exactly what its Save sends for these fields):
 * workflow id, version, enabled flag, embedded triggers and the START step's pre-conditions.
 */
export function buildTriggerBacktestProposal(values: WorkflowEditorValues): Record<string, unknown> {
  return {
    workflowId: values.workflowId,
    version: values.version,
    enabled: values.enabled,
    triggers: readArray(values.triggers),
    startPreConditions: readArray(values.startPreConditions),
  }
}

/**
 * The editor fields of a simulated trigger backtest proposal (the inverse of
 * `buildTriggerBacktestProposal` for what the editor can take back: triggers, enabled flag and
 * version; the START pre-conditions live on the canvas). `null` for anything else.
 */
export function triggerBacktestProposalToEditorChange(proposal: unknown): TriggerBacktestEditorChange | null {
  if (!isRecord(proposal)) return null
  if (typeof proposal.workflowId !== 'string' || !Array.isArray(proposal.triggers)) return null
  if (typeof proposal.version !== 'number' || typeof proposal.enabled !== 'boolean') return null
  return { version: proposal.version, enabled: proposal.enabled, triggers: [...proposal.triggers] }
}

/**
 * Reads a trigger backtest group key (`<triggerId>:<eventId>`, or `<triggerId>` for a trigger
 * without recorded events) and the trigger's name and pattern from the run's own proposal.
 */
export function describeTriggerBacktestGroup(groupKey: string, proposal: unknown): TriggerBacktestGroupDescription {
  const separator = groupKey.indexOf(':')
  const triggerId = separator >= 0 ? groupKey.slice(0, separator) : groupKey
  const eventId = separator >= 0 ? groupKey.slice(separator + 1) || null : null
  const triggers = isRecord(proposal) ? readArray(proposal.triggers) : []
  const trigger = triggers.find((entry) => isRecord(entry) && entry.triggerId === triggerId)
  const name = isRecord(trigger) && typeof trigger.name === 'string' && trigger.name.trim().length > 0 ? trigger.name : null
  const eventPattern = isRecord(trigger) && typeof trigger.eventPattern === 'string' ? trigger.eventPattern : null
  return { triggerId, eventId, name, eventPattern }
}
