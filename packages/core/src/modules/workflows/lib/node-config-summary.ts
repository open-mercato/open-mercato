/**
 * Workflows Module - One-line node config summary (pure)
 *
 * Fidelity gap #6. The design's nodes are not bigger than ours — measured, ours
 * are WIDER — they are more informative, because the body line states the step's
 * CONFIGURATION (`customers.deals.update · retries 3×`) instead of two clamped
 * lines of the author's prose, which truncate mid-word and cannot tell you which
 * command runs, which agent is invoked, or what the threshold is.
 *
 * The summary is derived, never authored: everything below already sits on the
 * step. `description` is not lost — it becomes the card's tooltip.
 *
 * PURE: no React, no `@xyflow/react`, no ORM, so the rule is testable without a
 * canvas and `graph-utils` could consume it if the layout ever needs to.
 */

import type { TranslateFn, TranslateParams } from '@open-mercato/shared/lib/i18n/context'

export type NodeConfigSummaryTranslationKey =
  | 'workflows.nodeSummary.alwaysAsk'
  | 'workflows.nodeSummary.assigned'
  | 'workflows.nodeSummary.autoApproveThreshold'
  | 'workflows.nodeSummary.bound'
  | 'workflows.nodeSummary.decisions'
  | 'workflows.nodeSummary.retries'
  | 'workflows.nodeSummary.role'
  | 'workflows.nodeSummary.until'

/** A summary is segments so command ids can render monospaced and labels can be translated. */
export type NodeConfigSummarySegment =
  | {
      text: string
      translationKey?: never
      translationParams?: never
      mono?: boolean
    }
  | {
      text?: never
      translationKey: NodeConfigSummaryTranslationKey
      translationParams?: TranslateParams
      mono?: boolean
    }

export const NODE_CONFIG_SUMMARY_SEPARATOR = ' · '

export interface NodeConfigSummarySource {
  activities?: Array<{ activityType?: string; config?: Record<string, unknown> } | null> | null
  activityType?: string
  activityId?: string
  activityConfig?: Record<string, unknown> | null
  retryPolicy?: { maxAttempts?: number } | null
  agentId?: string
  assignedTo?: string
  assignedToRoles?: string[] | null
  entityBindings?: Array<unknown> | null
  decisions?: Array<unknown> | null
  signalName?: string
  duration?: string
  until?: string
  config?: Record<string, unknown> | null
  subWorkflowId?: string
  [key: string]: unknown
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function firstActivityConfig(
  data: NodeConfigSummarySource,
  activityType: string,
): Record<string, unknown> | null {
  const match = (data.activities ?? []).find(
    (activity) => activity && activity.activityType === activityType,
  )
  if (match?.config) return match.config
  if (data.activityType === activityType && data.activityConfig) return data.activityConfig
  return null
}

function retrySegment(data: NodeConfigSummarySource): NodeConfigSummarySegment | null {
  const attempts = data.retryPolicy?.maxAttempts
  if (typeof attempts !== 'number' || attempts <= 1) return null
  return {
    translationKey: 'workflows.nodeSummary.retries',
    translationParams: { count: attempts },
  }
}

function automatedSummary(data: NodeConfigSummarySource): NodeConfigSummarySegment[] {
  const segments: NodeConfigSummarySegment[] = []

  const updateEntity = firstActivityConfig(data, 'UPDATE_ENTITY')
  const commandId = text(updateEntity?.commandId)
  const executeFunction = firstActivityConfig(data, 'EXECUTE_FUNCTION')
  const functionName = text(executeFunction?.functionName)
  const emitEvent = firstActivityConfig(data, 'EMIT_EVENT')
  const eventId = text(emitEvent?.eventId) ?? text(emitEvent?.event)

  const identifier = commandId ?? functionName ?? eventId
  if (identifier) {
    segments.push({ text: identifier, mono: true })
  } else {
    const activityType =
      text(data.activityType) ??
      text((data.activities ?? []).find((activity) => activity?.activityType)?.activityType)
    if (activityType) segments.push({ text: activityType, mono: true })
  }

  const retries = retrySegment(data)
  if (retries) segments.push(retries)
  return segments
}

function invokeAgentSummary(data: NodeConfigSummarySource): NodeConfigSummarySegment[] {
  const agentConfig = firstActivityConfig(data, 'INVOKE_AGENT')
  const agentId = text(data.agentId) ?? text(agentConfig?.agentId)
  const segments: NodeConfigSummarySegment[] = []
  if (agentId) segments.push({ text: agentId, mono: true })

  // The threshold is the single most consequential thing about an agent step —
  // it decides whether a human ever sees the proposal — so it belongs on the
  // face rather than three clicks into the inspector.
  const onResult = agentConfig?.onResult as
    | { autoApproveThreshold?: unknown; alwaysAsk?: unknown }
    | undefined
  if (onResult?.alwaysAsk === true) {
    segments.push({ translationKey: 'workflows.nodeSummary.alwaysAsk' })
  } else if (typeof onResult?.autoApproveThreshold === 'number') {
    segments.push({
      translationKey: 'workflows.nodeSummary.autoApproveThreshold',
      translationParams: { threshold: onResult.autoApproveThreshold },
    })
  }
  return segments
}

function userTaskSummary(data: NodeConfigSummarySource): NodeConfigSummarySegment[] {
  const segments: NodeConfigSummarySegment[] = []
  const roles = (data.assignedToRoles ?? []).filter((role): role is string => !!text(role))
  if (roles.length > 0) {
    segments.push({
      translationKey: 'workflows.nodeSummary.role',
      translationParams: { roles: roles.join(', ') },
    })
  } else if (text(data.assignedTo)) {
    segments.push({ translationKey: 'workflows.nodeSummary.assigned' })
  }

  const bindings = data.entityBindings ?? []
  if (bindings.length > 0) {
    segments.push({
      translationKey: 'workflows.nodeSummary.bound',
      translationParams: { count: bindings.length },
    })
  }

  const decisions = (data.decisions ?? []).length
  if (decisions > 0) {
    segments.push({
      translationKey: 'workflows.nodeSummary.decisions',
      translationParams: { count: decisions },
    })
  }
  return segments
}

function waitForSignalSummary(data: NodeConfigSummarySource): NodeConfigSummarySegment[] {
  const signalName =
    text(data.signalName) ??
    text((data.config as { signalName?: unknown } | null)?.signalName) ??
    text((data as { signalConfig?: { signalName?: unknown } }).signalConfig?.signalName)
  return signalName ? [{ text: signalName, mono: true }] : []
}

function waitForTimerSummary(data: NodeConfigSummarySource): NodeConfigSummarySegment[] {
  const duration = text(data.duration) ?? text((data.config as { duration?: unknown } | null)?.duration)
  if (duration) return [{ text: duration }]
  const until = text(data.until) ?? text((data.config as { until?: unknown } | null)?.until)
  return until
    ? [{
        translationKey: 'workflows.nodeSummary.until',
        translationParams: { value: until },
      }]
    : []
}

function subWorkflowSummary(data: NodeConfigSummarySource): NodeConfigSummarySegment[] {
  const subWorkflowId =
    text(data.subWorkflowId) ?? text((data.config as { subWorkflowId?: unknown } | null)?.subWorkflowId)
  return subWorkflowId ? [{ text: subWorkflowId, mono: true }] : []
}

const SUMMARY_BUILDERS: Record<string, (data: NodeConfigSummarySource) => NodeConfigSummarySegment[]> = {
  automated: automatedSummary,
  invokeAgent: invokeAgentSummary,
  userTask: userTaskSummary,
  waitForSignal: waitForSignalSummary,
  waitForTimer: waitForTimerSummary,
  subWorkflow: subWorkflowSummary,
}

/**
 * The card's body line for a node type, or an empty list when the step carries
 * nothing worth stating — in which case the card falls back to the author's
 * description exactly as it did before, so an unconfigured node never gets
 * emptier than it was.
 */
export function buildNodeConfigSummary(
  nodeType: string,
  data: NodeConfigSummarySource | null | undefined,
): NodeConfigSummarySegment[] {
  const builder = SUMMARY_BUILDERS[nodeType]
  if (!builder || !data) return []
  return builder(data)
}

export function resolveNodeConfigSummarySegment(
  segment: NodeConfigSummarySegment,
  translate: TranslateFn,
): string {
  if (segment.translationKey) {
    return translate(segment.translationKey, segment.translationParams)
  }
  return segment.text
}

export function formatNodeConfigSummary(
  segments: NodeConfigSummarySegment[],
  translate: TranslateFn,
): string {
  return segments
    .map((segment) => resolveNodeConfigSummarySegment(segment, translate))
    .join(NODE_CONFIG_SUMMARY_SEPARATOR)
}
