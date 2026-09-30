import type { SearchStep } from '@open-mercato/web-research'
import { emitAgentOrchestratorEvent } from '../../events'

export const WEB_SEARCH_PROGRESS_EVENT = 'agent_orchestrator.web_search.progress'

/** Steps worth showing an operator; the rest are noise in a live feed. */
const NARRATED_EVENTS = new Set([
  'started',
  'ok',
  'empty',
  'blocked',
  'timeout',
  'unavailable',
  'error',
  'cancelled',
  'escalated',
  'cached',
  'completed',
])

const MAX_DETAIL_CHARS = 240

export type WebSearchProgressScope = {
  readonly runId: string | null
  readonly agentId: string | null
  readonly tenantId: string | null
  readonly organizationId: string | null
  readonly query: string
}

export type WebSearchProgressPayload = {
  readonly id: string
  readonly runId: string | null
  readonly agentId: string | null
  readonly tenantId: string | null
  readonly organizationId: string | null
  readonly sequence: number
  readonly phase: SearchStep['phase']
  readonly event: SearchStep['event']
  readonly adapterId: string | null
  readonly detail: string | null
  readonly latencyMs: number | null
  readonly resultCount: number | null
  readonly query: string
}

export function toProgressPayload(step: SearchStep, scope: WebSearchProgressScope): WebSearchProgressPayload {
  const detail = step.detail ?? null
  return {
    id: scope.runId ?? scope.query,
    runId: scope.runId,
    agentId: scope.agentId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    sequence: step.seq,
    phase: step.phase,
    event: step.event,
    adapterId: step.adapterId ?? null,
    detail: detail && detail.length > MAX_DETAIL_CHARS ? `${detail.slice(0, MAX_DETAIL_CHARS - 1)}…` : detail,
    latencyMs: step.metrics?.latencyMs ?? null,
    resultCount: step.metrics?.resultCount ?? null,
    query: scope.query.length > 120 ? `${scope.query.slice(0, 119)}…` : scope.query,
  }
}

/**
 * Bridges engine steps to the live UI. Emission is fire-and-forget on purpose:
 * a search must not fail, or even slow down, because the event bus is unhappy.
 */
export function createStepEmitter(scope: WebSearchProgressScope): (step: SearchStep) => void {
  return (step) => {
    if (!NARRATED_EVENTS.has(step.event)) return
    void emitAgentOrchestratorEvent(WEB_SEARCH_PROGRESS_EVENT, toProgressPayload(step, scope)).catch(
      () => undefined,
    )
  }
}
