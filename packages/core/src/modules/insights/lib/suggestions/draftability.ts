import type { XrayWorkflowDraftService, XrayWorkflowScope } from '../workflowsBridge'
import type { XraySuggestionNotDraftableReason } from './constants'
import {
  assessSuggestionTrigger,
  buildSuggestionWorkflowDraft,
  reasonOfDraftIssues,
  type DraftValidationIssue,
  type SuggestionDraftLabels,
  type SuggestionEventCatalog,
  type SuggestionProcess,
  type SuggestionRule,
} from './draft'

export type SuggestionDraftOutcome =
  | {
    draftable: true
    eventId: string
    payload: unknown
    commands: Array<{ commandId: string; requiredFeatures: string[] }>
    workflowIdAvailable: boolean
  }
  | {
    draftable: false
    reason: XraySuggestionNotDraftableReason
    eventId: string | null
    issues: DraftValidationIssue[]
  }

/**
 * Labels of a draft that is only validated (mining): identifiers, never shown or stored. The
 * draft route builds its payload with translated labels instead.
 */
export function neutralSuggestionDraftLabels(rule: Pick<SuggestionRule, 'processKey' | 'signatureHash'>): SuggestionDraftLabels {
  const name = `Process X-Ray ${rule.processKey} ${rule.signatureHash.slice(0, 8)}`
  return {
    workflowName: name,
    description: name,
    triggerName: name,
    start: 'Start',
    end: 'End',
    recordId: 'Record',
    stepName: (fieldKey, value) => `${fieldKey} ${value}`,
  }
}

/**
 * Builds and validates the disabled workflow draft of a suggestion, or tells why it cannot be
 * drafted, checking in order: the trigger and the condition must be expressible over the trigger
 * event's payload (`trigger_not_expressible`, `condition_not_expressible`), the process must declare
 * its update command (`no_command`), the workflows module must be present (`workflows_unavailable`)
 * and accept the draft (`command_not_workflow_safe` when the command is not catalogued as
 * workflow-safe, `draft_invalid` otherwise; the workflows draft policy allows UPDATE_ENTITY, WAIT
 * and SET_VARIABLE only and never a credential-bearing activity). Persists nothing; the caller's
 * own features are the route's check (`command_forbidden`).
 */
export async function prepareSuggestionDraft(params: {
  process: SuggestionProcess
  rule: SuggestionRule
  catalog: SuggestionEventCatalog
  service: XrayWorkflowDraftService | null
  scope: XrayWorkflowScope
  labels: SuggestionDraftLabels
  workflowId?: string
}): Promise<SuggestionDraftOutcome> {
  const trigger = assessSuggestionTrigger(params.process, params.rule, params.catalog)
  if (!trigger.ok) return { draftable: false, reason: trigger.reason, eventId: null, issues: [] }
  const eventId = trigger.expression.eventId
  if (!params.process.automation) return { draftable: false, reason: 'no_command', eventId, issues: [] }
  if (!params.service) return { draftable: false, reason: 'workflows_unavailable', eventId, issues: [] }
  const payload = buildSuggestionWorkflowDraft({
    process: params.process,
    rule: params.rule,
    expression: trigger.expression,
    labels: params.labels,
    workflowId: params.workflowId,
  })
  if (!payload) return { draftable: false, reason: 'no_command', eventId, issues: [] }
  const validation = await params.service.validateDraftDefinition(payload, params.scope)
  if (!validation.ok) {
    const issues = validation.issues.map((issue) => ({ path: issue.path, code: issue.code }))
    return { draftable: false, reason: reasonOfDraftIssues(issues), eventId, issues }
  }
  return {
    draftable: true,
    eventId,
    payload: validation.payload,
    commands: validation.commands,
    workflowIdAvailable: validation.workflowIdAvailable,
  }
}
