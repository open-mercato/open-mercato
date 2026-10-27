import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { AiModelFactoryError } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/model-factory'
import { agentRunRequestSchema, baseAgentResultSchema, guardrailKind, guardrailPhase } from '../../data/validators'
import { AgentProposal } from '../../data/entities'
import {
  AgentGuardrailBlockedError,
  AgentNotFoundError,
  AgentOutputInvalidError,
  AgentRunTimeoutError,
} from './agentRuntime'
import { isAgentInvokeDeniedError } from './errors'
import { isAgentCapacityError, resolveAdmissionMaxWaitMs } from './admission'
import { invokeDeniedBody } from '../access/invokeDenial'

/**
 * The request/response/error contract shared by every HTTP door that runs one
 * agent synchronously (`POST /agents/:id/run`, `POST /agent-api/agents/:id/run`).
 * Doors differ only in how they authenticate the caller and build the run ctx.
 */

const logger = createLogger('agent_orchestrator').child({ component: 'agent-run-api' })

export const agentRunErrorSchema = z.object({ error: z.string() })

/** 422 body for a guardrail `block` verdict — distinct from plain invalid output. */
export const guardrailBlockedErrorSchema = agentRunErrorSchema.extend({
  code: z.literal('guardrail_blocked'),
  kind: guardrailKind,
  phase: guardrailPhase,
  guardrailSetVersion: z.string().nullable(),
})

/** 500 body for a failure this route could not classify — it names itself. */
export const unclassifiedErrorSchema = agentRunErrorSchema.extend({
  code: z.literal('agent_run_failed'),
  reason: z.string().optional(),
})

/** 503 body for a deployment whose LLM provider is missing or unusable. */
export const modelUnavailableErrorSchema = agentRunErrorSchema.extend({
  code: z.enum(['no_provider_configured', 'api_key_missing', 'provider_rejected']),
})

export const agentRunSuccessResponseSchema = baseAgentResultSchema.and(
  z.object({ runId: z.string().uuid().nullable(), proposalId: z.string().uuid().nullable() }),
)

/**
 * Did the configured provider REFUSE the call for a reason that is about this
 * deployment rather than about the request?
 *
 * Detected structurally, the way the runtime already recognises a guardrail
 * block and a capacity error, so this module keeps importing no AI SDK. The
 * status set is deliberately narrow: 401/402/403 are authentication and billing,
 * 429 is exhausted quota. A plain 400 is NOT included — that is where a genuinely
 * malformed request from our own schema would land, and labelling that an
 * environment problem would hide our bug — except for the one unmistakable case
 * where the provider spends a 400 on a billing state (Anthropic answers "credit
 * balance is too low" that way).
 */
const PROVIDER_REFUSAL_STATUSES = new Set([401, 402, 403, 429])
const BILLING_REFUSAL = /credit balance|billing|insufficient[_ ]quota|payment required/i

const MODEL_FACTORY_ERROR_CODES = new Set(['no_provider_configured', 'api_key_missing'])

/**
 * Is this the model factory saying the deployment cannot resolve a model?
 *
 * `instanceof` alone is not enough: the run executes behind the admission queue,
 * and by the time the error surfaces here it no longer carries the factory's
 * prototype — CI caught a pinned-provider failure ("the model is pinned to
 * openai, but that provider is not configured") falling past the 503 branch into
 * the unclassified 500. The name and the code survive that crossing, so they are
 * what we match on, the same way the provider-refusal check above works.
 */
function asModelFactoryError(err: unknown): { code: string } | null {
  if (err instanceof AiModelFactoryError) return { code: err.code }
  if (!err || typeof err !== 'object') return null
  const candidate = err as { name?: unknown; code?: unknown }
  if (candidate.name !== 'AiModelFactoryError') return null
  const code = typeof candidate.code === 'string' && MODEL_FACTORY_ERROR_CODES.has(candidate.code)
    ? candidate.code
    : 'no_provider_configured'
  return { code }
}

function isProviderRefusal(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const candidate = err as { name?: unknown; statusCode?: unknown; responseBody?: unknown }
  if (candidate.name !== 'AI_APICallError') return false
  const status = typeof candidate.statusCode === 'number' ? candidate.statusCode : null
  if (status !== null && PROVIDER_REFUSAL_STATUSES.has(status)) return true
  const body = typeof candidate.responseBody === 'string' ? candidate.responseBody : ''
  return status === 400 && BILLING_REFUSAL.test(body)
}

export type ParsedAgentRunRequest =
  | { ok: true; input: unknown }
  | { ok: false; response: NextResponse }

export function parseAgentRunRequest(body: unknown): ParsedAgentRunRequest {
  const parsed = agentRunRequestSchema.safeParse(body)
  if (parsed.success) return { ok: true, input: parsed.data.input }
  return {
    ok: false,
    response: NextResponse.json(
      { error: 'Validation failed', fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 422 },
    ),
  }
}

/**
 * Captures the persisted run id (navigation spec §1): the runners fire
 * `onRunPersisted` for every run they create — nested sub-agent delegations
 * included — so only the FIRST invocation, the top-level run, is kept.
 */
export function createRunIdObserver(): { onRunPersisted: (runId: string) => void; runId: () => string | null } {
  let observedRunId: string | null = null
  return {
    onRunPersisted: (persistedRunId) => {
      if (!observedRunId) observedRunId = persistedRunId
    },
    runId: () => observedRunId,
  }
}

export type AgentRunErrorResponseOptions = {
  /**
   * Include the unclassified error's name and message as `reason` on the 500
   * body. Staff doors keep it (default `true`); the agent-token door, whose
   * callers are external principals, passes `false` — the server log keeps the
   * detail.
   */
  exposeReason?: boolean
}

/** Maps a failed `agentRuntime.run` to the shared HTTP error contract. */
export function agentRunErrorResponse(
  err: unknown,
  agentId: string,
  runId: string | null,
  options: AgentRunErrorResponseOptions = {},
): NextResponse {
  if (err instanceof AgentNotFoundError) {
    return NextResponse.json({ error: 'Agent not found', code: 'agent_not_found' }, { status: 404 })
  }
  if (isAgentInvokeDeniedError(err)) {
    return NextResponse.json(invokeDeniedBody(err, agentId), { status: 403 })
  }
  // Subclass FIRST: a guardrail block is a policy verdict, not a model bug —
  // the typed reason (kind/phase/set version) must reach the client instead
  // of the generic invalid-output message (data-honesty spec §3.6).
  if (err instanceof AgentGuardrailBlockedError) {
    return NextResponse.json(
      {
        error: 'Blocked by a runtime guardrail',
        code: 'guardrail_blocked',
        kind: err.kind,
        phase: err.phase,
        guardrailSetVersion: err.guardrailSetVersion ?? null,
      },
      { status: 422 },
    )
  }
  if (err instanceof AgentOutputInvalidError) {
    return NextResponse.json(
      { error: 'Agent produced invalid output', code: 'agent_output_invalid' },
      { status: 422 },
    )
  }
  if (err instanceof AgentRunTimeoutError) {
    return NextResponse.json(
      { error: 'The agent run timed out before producing a result', code: 'agent_run_timeout' },
      { status: 422 },
    )
  }
  if (isAgentCapacityError(err)) {
    const retryAfterSeconds = Math.max(1, Math.ceil(resolveAdmissionMaxWaitMs() / 1000))
    return NextResponse.json(
      { error: 'Agent run capacity is exhausted — retry shortly', code: 'agent_capacity_exhausted' },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
    )
  }
  // A deployment with no LLM provider (or a provider whose key never
  // resolved) is a MIS-PROVISIONED ENVIRONMENT, not a bad request and not a
  // bad model answer — so it is 503, not one of this route's 422s, which all
  // mean "the run happened and its outcome is unusable". Mirrors the mapping
  // the ai_assistant routing endpoint already uses for the same error.
  const modelFactoryError = asModelFactoryError(err)
  if (modelFactoryError) {
    return NextResponse.json(
      { error: 'No LLM provider is configured for this deployment', code: modelFactoryError.code },
      { status: 503 },
    )
  }
  // A provider that refuses the call — no credit, revoked key, exhausted quota —
  // leaves this deployment unable to run a model, exactly like a provider that
  // was never configured. Same 503, own code, so a caller can tell "nothing is
  // wired" from "what is wired will not serve us".
  if (isProviderRefusal(err)) {
    logger.error('Agent run refused by the LLM provider', { agentId, runId, err })
    return NextResponse.json(
      { error: 'The configured LLM provider refused the request for this deployment', code: 'provider_rejected' },
      { status: 503 },
    )
  }
  // Anything past the typed mappings above used to rethrow into an
  // empty-bodied 500: unreadable from the client, and — because the app runs
  // as its own process whose output the harness captures rather than prints —
  // invisible in CI too. A failing run then reported only "expected 200,
  // received 500", which names nothing.
  //
  // It answers with its own body now, carrying the error's name and a
  // truncated message. Every door is gated on the run capability, the message is
  // operational detail ("provider refused", "column does not exist"), and the
  // provider's response body — which echoes the request — is never included.
  logger.error('Agent run failed with an unclassified error', { agentId, runId, err })
  if (options.exposeReason === false) {
    return NextResponse.json(
      { error: 'The agent run failed unexpectedly', code: 'agent_run_failed' },
      { status: 500 },
    )
  }
  const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  return NextResponse.json(
    {
      error: 'The agent run failed unexpectedly',
      code: 'agent_run_failed',
      reason: reason.slice(0, 300),
    },
    { status: 500 },
  )
}

/**
 * The success body: the typed result plus additive sibling fields (navigation
 * spec §1). The `AgentResult` union never defines `runId`/`proposalId`, so
 * spreading is collision-free. Id-only projection — no encrypted proposal
 * columns are fetched.
 */
export async function agentRunSuccessResponse(
  container: AwilixContainer,
  result: unknown,
  runId: string | null,
  scope: { tenantId: string; organizationId: string },
): Promise<NextResponse> {
  let proposalId: string | null = null
  if (runId) {
    const em = (container.resolve('em') as EntityManager).fork()
    const proposals = await em.find(
      AgentProposal,
      { runId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
      { orderBy: { createdAt: 'desc' }, limit: 1, fields: ['id'] },
    )
    proposalId = proposals[0]?.id ?? null
  }
  const resultRecord = (result && typeof result === 'object' ? result : {}) as Record<string, unknown>
  return NextResponse.json({ ...resultRecord, runId, proposalId })
}
