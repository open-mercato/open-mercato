/**
 * Lifecycle announcements for the `external` runtime (external-agent-invocation
 * design; tracker task 2.8) — the only place `agent_orchestrator.external_run.*`
 * is emitted.
 *
 * TWO PROPERTIES MAKE THIS ITS OWN MODULE.
 *
 * **1. Payload discipline is structural, not a convention.** An external run's
 * data is the most sensitive this module handles: the request payload is a brief
 * naming a person and a phone number, the result payload is a transcript of what a
 * human actually said, and the correlation row carries a bearer token. Every event
 * emitted here is PERSISTED (and a future `clientBroadcast` would put it on an
 * ACL-blind SSE feed), so anything that reaches a payload is stored and, later,
 * possibly shown. The emitter therefore builds its payload key by key from a typed
 * fact set — it never spreads a caller's object, never accepts a free-text detail,
 * and reports failure as a CLASSIFIED ENUM rather than the provider's message,
 * which routinely quotes the number it dialled or the body it could not parse.
 *
 * **2. Emission is best-effort, always.** These are announcements about work that
 * already happened. A run has been placed with a third party, or an audit row is
 * already terminal and a parked workflow step has already been woken. Letting a
 * failing event bus throw here would fail a run whose side effect is live in the
 * world, or unwind a settlement that cannot be replayed (the correlation row is
 * claimed, so a retry reports `already_settled`). So every emit is wrapped: it logs
 * and returns.
 */

import { createLogger } from '@open-mercato/shared/lib/logger'
import { emitAgentOrchestratorEvent } from '../../events'
import type { ExternalRunFailureCause, ExternalRunResumeStatus } from './completeExternalRun'

const logger = createLogger('agent_orchestrator').child({ component: 'external-run-events' })

/** The four lifecycle facts an external run can announce. */
export type ExternalRunEventId =
  | 'agent_orchestrator.external_run.started'
  | 'agent_orchestrator.external_run.completed'
  | 'agent_orchestrator.external_run.failed'
  | 'agent_orchestrator.external_run.expired'

/**
 * Everything an external-run event may identify. IDS AND SCOPE ONLY — every field
 * here is a uuid, a registry id or a provider-side run id. There is deliberately no
 * field for the brief, the transcript, the callback token or a provider message,
 * and adding one is the mistake this type exists to make visible in review.
 */
export type ExternalRunEventFacts = {
  /** `agent_external_runs.id` — the correlation row. */
  externalRunRowId: string
  /** `agent_runs.id` — the audit row the cockpit renders. */
  runId: string
  agentId: string
  connectorId: string
  tenantId: string
  organizationId: string
  /** The provider's own run id (e.g. an ElevenLabs `conversation_id`), when known. */
  externalRunId?: string | null
  /** The parked workflow step, when this run has one. */
  processId?: string | null
  stepId?: string | null
}

/**
 * The settled half of the story, for the three terminal events.
 *
 * `cause` is the classified enum `completeExternalRun` already decided, never the
 * message behind it: a `connector_failure` reason can be the provider quoting the
 * number it failed to reach, and a `schema_invalid` detail is a zod error that
 * echoes the values it rejected — which for a voice agent means the transcript.
 * The full detail stays where it belongs, on the (encrypted) correlation row.
 */
export type ExternalRunEventOutcome = {
  outcomeHandle?: 'researcher' | 'error' | 'guardrailBlocked'
  cause?: ExternalRunFailureCause
  /** Whether the parked workflow step actually woke — the fact risk R2 is about. */
  resume?: ExternalRunResumeStatus
}

/**
 * The exact key set an external-run event payload may carry. Exported so the tests
 * can assert the payload against it rather than against a hand-copied list that
 * would drift the first time a field is added.
 */
export const EXTERNAL_RUN_EVENT_PAYLOAD_KEYS = [
  'externalRunRowId',
  'runId',
  'agentId',
  'connectorId',
  'tenantId',
  'organizationId',
  'externalRunId',
  'processId',
  'stepId',
  'outcomeHandle',
  'cause',
  'resume',
] as const

/**
 * Announce one external-run lifecycle fact. Never throws.
 *
 * Persistent because these are durable domain facts an operator or a business rule
 * may need after the process that produced them is gone — the same choice
 * `proposal.ready` and `process_run.*` make.
 */
export async function emitExternalRunEvent(
  eventId: ExternalRunEventId,
  facts: ExternalRunEventFacts,
  outcome: ExternalRunEventOutcome = {},
): Promise<void> {
  try {
    await emitAgentOrchestratorEvent(eventId, buildExternalRunEventPayload(facts, outcome), {
      persistent: true,
    })
  } catch (error) {
    // Deliberately warn, not error: the fact this announces is already durable in
    // the database, so a lost announcement degrades observability and automation,
    // not correctness.
    logger.warn('could not announce an external run lifecycle event', {
      eventId,
      externalRunRowId: facts.externalRunRowId,
      runId: facts.runId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Build the payload field by field. The explicit construction IS the guarantee —
 * a spread of `facts` would happily carry whatever a future caller adds to the
 * object it passes, which is how a transcript ends up in an event log.
 */
export function buildExternalRunEventPayload(
  facts: ExternalRunEventFacts,
  outcome: ExternalRunEventOutcome = {},
): Record<string, unknown> {
  return {
    externalRunRowId: facts.externalRunRowId,
    runId: facts.runId,
    agentId: facts.agentId,
    connectorId: facts.connectorId,
    tenantId: facts.tenantId,
    organizationId: facts.organizationId,
    externalRunId: facts.externalRunId ?? null,
    processId: facts.processId ?? null,
    stepId: facts.stepId ?? null,
    ...(outcome.outcomeHandle ? { outcomeHandle: outcome.outcomeHandle } : {}),
    ...(outcome.cause ? { cause: outcome.cause } : {}),
    ...(outcome.resume ? { resume: outcome.resume } : {}),
  }
}
