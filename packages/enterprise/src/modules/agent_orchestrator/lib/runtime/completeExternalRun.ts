/**
 * The COMPLETION half of the `external` runtime (external-agent-invocation design
 * §5.2 / §5.5; tracker task 2.4) — what runs when the provider finally answers.
 *
 * The start half (`./externalAgentRunner`) opened an audited `AgentRun`, screened
 * the outbound brief through the input guardrail, handed the provider a single-use
 * callback token and then stopped, holding nothing. Minutes later a verified
 * callback (T2.6) or the deadline sweep (T2.7) arrives here with a normalized
 * payload — or with a reported failure — and this is where the run is proved,
 * screened, closed and the parked workflow step woken.
 *
 * Four properties are load-bearing:
 *
 * 1. **Exactly once, whatever the provider does.** Every settlement begins by
 *    CLAIMING the correlation row with a conditional `pending → terminal` update.
 *    A redelivered webhook claims nothing, changes nothing and — critically —
 *    resumes nothing: a second `sendSignal` would advance a run past a step it
 *    already left.
 * 2. **The answer must be what the agent promised.** The connector-normalized
 *    payload is validated against the agent's declared OUTCOME envelope and
 *    screened by the same `checkOutput` guardrail the native runner applies to
 *    model output. A third party's answer gets no more trust than our own model's.
 * 3. **The audit row is closed before the workflow moves**, and guardrail checks
 *    are persisted BEFORE the run can fail — the ordering `NativeAgentRunner`
 *    established, so a blocked run always leaves the evidence that explains it.
 * 4. **A resume failure never rewrites history.** The run genuinely completed; if
 *    the signal cannot be delivered the run stays terminal and says so, and the
 *    parked instance is left for an operator rather than silently marked failed.
 *
 * WHY THIS IS ITS OWN MODULE (the design sketched it as "a second function in the
 * same module"): two of its three entry points — the unauthenticated callback
 * route and the deadline sweep worker — need ONLY this half, and importing the
 * runner would drag the whole start path (context assembly, the TDCR bundle
 * resolver, the input guardrail preflight) into their module graphs. Keeping the
 * dependency one-way (runner → completion) is also what lets the synchronous
 * connector arm reuse this function without an import cycle.
 */

import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { ensureAgentsLoaded, getAgentEntry, type AgentRegistryEntry } from '../sdk/defineAgent'
import type { AgentResult, GuardrailKindInput, GuardrailPhaseInput } from '../../data/validators'
import { GuardrailService, persistVerdict, GUARDRAIL_SET_VERSION } from '../guardrails/guardrailService'
import { emitExternalRunEvent } from './externalRunEvents'
import {
  claimExternalRunRow,
  completeRun,
  failRun,
  settleExternalRunRow,
  shapeResult,
} from './persistence'

const logger = createLogger('agent_orchestrator').child({ component: 'external-run-completion' })

/**
 * The signal that resumes a parked `INVOKE_AGENT` step. It MUST match the name
 * `lib/disposition/resume.ts` sends and the one core's `WAIT_FOR_SIGNAL` keys on:
 * a suspended external run parks exactly where a human-reviewed proposal parks,
 * and is resumed the same way. The correlation row snapshots it at start time, so
 * this constant is only the fallback for a row written before it was stored.
 */
export const EXTERNAL_RUN_RESUME_SIGNAL = 'agent_orchestrator.proposal.ready'

/** How much of a validation or provider message is kept on the row. */
const FAILURE_REASON_CHAR_LIMIT = 4000

/**
 * The columns of the correlation row this function needs. A subset rather than the
 * entity, so a caller can pass a row it read through any projection — and so the
 * unit tests never need an ORM.
 */
export type ExternalRunCorrelation = {
  id: string
  tenantId: string
  organizationId: string
  runId: string
  agentId: string
  connectorId: string
  /** The workflow resume triple; all three or none (T2.1's validator invariant). */
  processId?: string | null
  stepId?: string | null
  signalName?: string | null
}

/**
 * What came back — or the fact that nothing did.
 *
 * `result` is a normalized provider payload. `failure` is one the connector
 * already classified (the provider reported the call was never answered, the
 * callback carried a `call_initiation_failure`, `normalize()` could not map the
 * body). `expired` is the deadline sweep (T2.7) reporting that nobody ever
 * called: no payload exists and none is coming.
 *
 * All three settle the run and free the parked step. `result` differs in that it
 * has something to validate and screen; the other two go straight to the failure
 * arm. `expired` differs from `failure` in ONE respect — the terminal status
 * written on the correlation row — because "the provider told us it failed" and
 * "we gave up waiting" are different operational facts and an operator reading
 * the row must be able to tell them apart. The run and the workflow see the same
 * thing either way: a failed run down the `error` handle.
 */
export type ExternalRunSettlement =
  | { kind: 'result'; payload: unknown }
  | { kind: 'failure'; reason: string }
  | { kind: 'expired'; reason: string }

/** Why a settlement failed — reported so a caller can raise the right typed error. */
export type ExternalRunFailureCause =
  | 'connector_failure'
  | 'agent_not_registered'
  | 'schema_invalid'
  | 'guardrail_blocked'
  | 'deadline_expired'

/**
 * Which of core's five agent-outcome handles the parked step is resumed down.
 * External agents are researcher-kind only in this phase (an external PROPOSAL
 * agent would let a third party's confidence auto-approve a domain write), so the
 * success handle is always `researcher`.
 */
export type ExternalRunOutcomeHandle = 'researcher' | 'error' | 'guardrailBlocked'

/**
 * `skipped` is the honest answer for a run that never parked anything — a
 * synchronous connector, or a playground invocation with no workflow behind it.
 * `failed` means the run is settled but the step is still parked.
 */
export type ExternalRunResumeStatus = 'sent' | 'skipped' | 'failed'

export type CompleteExternalRunResult =
  | {
      status: 'completed'
      runId: string
      result: AgentResult
      outcomeHandle: 'researcher'
      resume: ExternalRunResumeStatus
    }
  | {
      status: 'failed'
      runId: string
      cause: ExternalRunFailureCause
      detail: string
      outcomeHandle: 'error' | 'guardrailBlocked'
      blockedReason?: { phase: GuardrailPhaseInput; kind: GuardrailKindInput }
      resume: ExternalRunResumeStatus
    }
  /** The row was not `pending`: a duplicate delivery, or the deadline already expired it. */
  | { status: 'already_settled'; runId: string }
  /** The caller's scope does not own the row. Nothing was read, written or resumed. */
  | { status: 'scope_denied'; runId: string }

export type CompleteExternalRunArgs = {
  container: AwilixContainer
  commandBus: CommandBus
  /** The correlation row, already resolved by the caller (by token hash, or by id). */
  row: ExternalRunCorrelation
  /**
   * The tenancy the CALLER is authorised for. For the callback route this is the
   * scope the verified provider signature established — never anything read out of
   * the request body.
   */
  scope: { tenantId: string; organizationId: string }
  settlement: ExternalRunSettlement
  /**
   * The registry entry, when the caller already holds it. Resolved from the agent
   * registry otherwise, which is what the out-of-process callers need.
   */
  entry?: AgentRegistryEntry
  /** Attribution for the resume signal; absent for an unauthenticated callback. */
  userId?: string | null
}

/**
 * Settle one external agent run and wake whatever was waiting on it.
 *
 * Never throws for an expected outcome — a duplicate delivery, a foreign scope, a
 * malformed payload and a guardrail block are all reported in the return value, so
 * the callback route can answer each with the right HTTP status instead of
 * discovering them by catching.
 */
export async function completeExternalRun(
  args: CompleteExternalRunArgs,
): Promise<CompleteExternalRunResult> {
  const { container, commandBus, row, scope, settlement } = args

  // Tenancy first, before anything is read, written or claimed. The claim below
  // ALSO carries both scope columns in its predicate — that is the enforcement
  // that survives a caller passing the row's own scope back to itself — but a
  // silent zero-row claim would be indistinguishable from a duplicate delivery,
  // and "somebody tried to settle another tenant's run" is a different fact that
  // deserves its own answer and its own log line.
  if (row.tenantId !== scope.tenantId || row.organizationId !== scope.organizationId) {
    logger.warn('refused to settle an external run outside the caller scope', {
      externalRunRowId: row.id,
      runId: row.runId,
      rowTenantId: row.tenantId,
      rowOrganizationId: row.organizationId,
      scopeTenantId: scope.tenantId,
      scopeOrganizationId: scope.organizationId,
    })
    return { status: 'scope_denied', runId: row.runId }
  }

  const commandCtx = buildCallbackCommandContext(container, scope)

  // 1. CLAIM. The status written here is PROVISIONAL for a result-bearing
  //    settlement: whether the payload is valid and passes the output guardrail is
  //    not known yet, and the row's enum has no "settling" state to park in.
  //    Claiming `completed` and correcting it to `failed` a few statements later
  //    (in the settle write) is the right trade: the property that must hold
  //    across processes is that exactly ONE caller proceeds past this line, and
  //    that is decided by the transition out of `pending`, not by which terminal
  //    state it lands in.
  const claimed = await claimExternalRunRow(commandBus, commandCtx, {
    externalRunRowId: row.id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    status: claimStatusFor(settlement),
  })
  if (!claimed) {
    logger.info('external run callback ignored; the run was already settled', {
      externalRunRowId: row.id,
      runId: row.runId,
      agentId: row.agentId,
      connectorId: row.connectorId,
    })
    return { status: 'already_settled', runId: row.runId }
  }

  const settleFailed = async (
    cause: ExternalRunFailureCause,
    detail: string,
    blockedReason?: { phase: GuardrailPhaseInput; kind: GuardrailKindInput },
  ): Promise<CompleteExternalRunResult> => {
    const outcomeHandle: 'error' | 'guardrailBlocked' =
      cause === 'guardrail_blocked' ? 'guardrailBlocked' : 'error'
    await failRun(commandBus, commandCtx, { runId: row.runId, errorMessage: detail })
    await settleExternalRunRow(commandBus, commandCtx, {
      externalRunRowId: row.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      // The ROW keeps the distinction the run and the workflow deliberately drop:
      // an expired row is the one NOBODY EVER ANSWERED, which is what the
      // cockpit, the deadline metrics and an operator triaging a stuck provider
      // need to see — a `failed` row means somebody answered badly. Note this is
      // not simply the claim's status: a `result` settlement claims `completed`
      // provisionally and lands here only when its payload turned out to be
      // schema-invalid or guardrail-blocked, which is a `failed` row.
      status: settlement.kind === 'expired' ? 'expired' : 'failed',
      failureReason: `${cause}: ${detail}`.slice(0, FAILURE_REASON_CHAR_LIMIT),
    })
    const resume = await resumeParkedStep({
      container,
      row,
      scope,
      outcomeHandle,
      userId: args.userId ?? null,
      failure: { detail, ...(blockedReason ? { blockedReason } : {}) },
    })
    // Announced from HERE rather than from the sweep (which T2.7 pencilled in as
    // the expiry emit point) because this side of the claim is the only place all
    // three terminal facts are exactly-once. Everything above runs behind the
    // conditional `pending → terminal` UPDATE, so a redelivered webhook racing a
    // deadline job produces one settlement and therefore one event — whereas an
    // emit in `expireExternalRun` would sit outside that guarantee and would cover
    // only one of the three arms. `expired` and `failed` stay separate ids for the
    // reason the ROW keeps them separate: "nobody answered" and "somebody answered
    // badly" are different operational facts.
    await emitExternalRunEvent(
      settlement.kind === 'expired'
        ? 'agent_orchestrator.external_run.expired'
        : 'agent_orchestrator.external_run.failed',
      externalRunEventFacts(row),
      // `cause` only — `detail` is a provider message or a zod error, both of which
      // routinely quote the transcript or the number that was dialled.
      { outcomeHandle, cause, resume },
    )
    return {
      status: 'failed',
      runId: row.runId,
      cause,
      detail,
      outcomeHandle,
      ...(blockedReason ? { blockedReason } : {}),
      resume,
    }
  }

  if (settlement.kind === 'failure') {
    return settleFailed('connector_failure', settlement.reason)
  }

  // The deadline sweep (T2.7) got here first: nobody called back before
  // `expires_at`. Structurally identical to a connector-reported failure — there
  // is no payload to validate and no guardrail to run, so the run fails and the
  // parked step wakes down the `error` handle. An unanswered call is a failure to
  // OBTAIN the answer, not a guardrail matter: nothing was refused on content, so
  // routing it to `guardrailBlocked` would send it to the human-escalation path
  // for a fact the author's own error route already handles.
  if (settlement.kind === 'expired') {
    return settleFailed('deadline_expired', settlement.reason)
  }

  // 2. The agent's declared contract. Resolving it can fail legitimately: the run
  //    started half an hour ago and the agent may have been removed from the build
  //    since. That is a failed run down the `error` handle, not a crash — the
  //    alternative would leave the workflow parked forever on a deleted agent.
  const entry = args.entry ?? (await resolveAgentEntry(row.agentId))
  if (!entry) {
    return settleFailed(
      'agent_not_registered',
      `[internal] agent "${row.agentId}" is no longer registered, so its external result cannot be validated`,
    )
  }

  // 3. OUTPUT GUARDRAIL, in the ordering `NativeAgentRunner` established: compute
  //    the verdict, then decide, then persist the audit rows BEFORE the run is
  //    allowed to fail. A run that failed without its guardrail checks on record
  //    cannot be explained afterwards.
  const guardrailService = new GuardrailService(container)
  const verdict = await guardrailService.checkOutput({
    capability: row.agentId,
    schema: entry.schema,
    output: settlement.payload,
    allowedTools: entry.tools,
    // No grounding gate: the cite-or-abstain check scores claims against the
    // CITABLE SOURCES of the run's context bundle, which was assembled in another
    // process half an hour ago and is not reconstructible here. Running it without
    // them would block every external answer for citing nothing — a guardrail that
    // always fires teaches operators to ignore it. Screening the transcript as
    // UNTRUSTED text is the input guardrail's job in whichever agent reads it next
    // (design §7, risk R5), and that already happens.
  })
  const guardEm = (container.resolve('em') as EntityManager).fork()
  const guardScope = {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    agentRunId: row.runId,
  }

  const parsed = entry.schema.safeParse(settlement.payload)
  if (!parsed.success || verdict.result === 'block') {
    await persistVerdict({ em: guardEm }, guardScope, {
      verdict,
      capability: row.agentId,
      phase: 'output',
      proposalId: null,
    })
    // Two DIFFERENT facts, deliberately kept apart — and this is where the
    // external path diverges from the native one. In-process, a schema-invalid
    // object and a guardrail block are both the model misbehaving, so the native
    // runner reports them through one error. Here, a payload that does not match
    // the declared envelope means the CONNECTOR's `normalize()` is wrong — an
    // integration defect the workflow's `error` route is for — while a block means
    // the answer was well-formed and refused on its content, which is what the
    // `guardrailBlocked` route exists to escalate. Collapsing them would send
    // every connector bug to the escalation path.
    if (!parsed.success) {
      return settleFailed('schema_invalid', parsed.error.message)
    }
    const blockedReason = verdict.blockedReason
    return settleFailed(
      'guardrail_blocked',
      `guardrail block (${blockedReason?.kind ?? 'unknown'}) at guardrail set ${GUARDRAIL_SET_VERSION}`,
      blockedReason,
    )
  }

  // Pass/warn: the audit rows are written on this path too, exactly as native.
  await persistVerdict({ em: guardEm }, guardScope, {
    verdict,
    capability: row.agentId,
    phase: 'output',
    proposalId: null,
  })

  // 4. CLOSE THE AUDIT RUN. No proposal is created: external agents are
  //    researcher-kind only, so there is nothing to dispose and no confidence to
  //    derive — the run row renders `—`, honestly.
  const result = shapeResult(entry.resultKind, parsed.data, row.agentId)
  await completeRun(commandBus, commandCtx, {
    runId: row.runId,
    output: result,
    resultKind: entry.resultKind,
    confidence: null,
  })
  await settleExternalRunRow(commandBus, commandCtx, {
    externalRunRowId: row.id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    status: 'completed',
    resultPayload: settlement.payload,
  })

  // 5. WAKE THE PARKED STEP.
  const resume = await resumeParkedStep({
    container,
    row,
    scope,
    outcomeHandle: 'researcher',
    userId: args.userId ?? null,
    data: result.kind === 'researcher' ? result.data : undefined,
  })

  // The result itself is deliberately NOT in the payload. It is the transcript of a
  // conversation with a human; it lives encrypted on the correlation row and on the
  // run's output, both of which are behind an authenticated, feature-gated read.
  await emitExternalRunEvent(
    'agent_orchestrator.external_run.completed',
    externalRunEventFacts(row),
    { outcomeHandle: 'researcher', resume },
  )

  return { status: 'completed', runId: row.runId, result, outcomeHandle: 'researcher', resume }
}

/**
 * Project the correlation row onto the id-only fact set the events carry. A named
 * projection rather than an inline object so every emit site in this file carries
 * the same fields, and so adding a field is one reviewable edit instead of three.
 */
function externalRunEventFacts(row: ExternalRunCorrelation) {
  return {
    externalRunRowId: row.id,
    runId: row.runId,
    agentId: row.agentId,
    connectorId: row.connectorId,
    tenantId: row.tenantId,
    organizationId: row.organizationId,
    processId: row.processId ?? null,
    stepId: row.stepId ?? null,
  }
}

/**
 * The terminal status the CLAIM writes — the transition out of `pending` that
 * decides which caller proceeds.
 *
 * For a `result` it is provisional (`settleFailed` corrects it to `failed` if the
 * payload turns out not to hold up); for `failure` and `expired` it is already
 * final. What matters at this point is only that the row leaves `pending` exactly
 * once, so an inaccurate intermediate value is harmless — but an `expired` claim
 * that wrote `failed` would leave a window in which the row lied about why it was
 * settled, and a crash between the two writes would make that permanent.
 */
function claimStatusFor(settlement: ExternalRunSettlement): 'completed' | 'failed' | 'expired' {
  if (settlement.kind === 'result') return 'completed'
  if (settlement.kind === 'expired') return 'expired'
  return 'failed'
}

/**
 * The command context for a settlement.
 *
 * `auth: null` because the callback half genuinely has no authenticated actor —
 * it runs in the web process serving an unauthenticated route whose only
 * credential is the provider's verified signature, or in the sweep worker. The
 * tenancy comes from the correlation row the caller already resolved and verified,
 * never from a request body. Same shape as `api/trace/ingest`, the module's other
 * unauthenticated-but-verified write path.
 */
function buildCallbackCommandContext(
  container: AwilixContainer,
  scope: { tenantId: string; organizationId: string },
): CommandRuntimeContext {
  return {
    container,
    auth: null,
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
  }
}

async function resolveAgentEntry(agentId: string): Promise<AgentRegistryEntry | undefined> {
  try {
    await ensureAgentsLoaded()
  } catch (err) {
    logger.warn('agent registry could not be loaded while settling an external run', {
      agentId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
  return getAgentEntry(agentId)
}

type ResumeParkedStepArgs = {
  container: AwilixContainer
  row: ExternalRunCorrelation
  scope: { tenantId: string; organizationId: string }
  outcomeHandle: ExternalRunOutcomeHandle
  userId: string | null
  data?: unknown
  failure?: {
    detail: string
    blockedReason?: { phase: GuardrailPhaseInput; kind: GuardrailKindInput }
  }
}

/**
 * Deliver the resume signal to the parked `INVOKE_AGENT` step.
 *
 * Reaches core's `sendSignal` through the same dynamic-import-inside-try/catch
 * `lib/disposition/resume.ts` uses, so `workflows` stays an OPTIONAL peer: a build
 * without it degrades to a logged warning instead of a module-resolution failure
 * at import time. The workflows context keys are imported the same way for the
 * same reason.
 *
 * FAILURE ISOLATION. A resume failure is reported, never thrown. The run really
 * did complete — the provider answered, the payload was screened and the audit row
 * is terminal — so rolling any of that back to make the signal retryable would
 * falsify the record, and re-running the settlement is impossible anyway: the
 * correlation row is claimed, so a retried delivery would report `already_settled`.
 * The instance therefore stays PAUSED on its resume signal and is recoverable by
 * an operator with a manual signal, which is precisely the stance core's own
 * `handleInvokeAgentJob` takes when its post-run resume fails ("left parked").
 */
async function resumeParkedStep(args: ResumeParkedStepArgs): Promise<ExternalRunResumeStatus> {
  const { container, row, scope, outcomeHandle } = args
  // No triple means nothing parked: a synchronous connector, or an invocation with
  // no workflow behind it. T2.1's validator makes the three all-or-nothing, so a
  // row can never name a step it cannot address.
  if (!row.processId || !row.stepId) return 'skipped'

  try {
    const signalHandler = (await import(
      '@open-mercato/core/modules/workflows/lib/signal-handler'
    )) as typeof import('@open-mercato/core/modules/workflows/lib/signal-handler')
    const payload = await buildResumePayload(args)
    const em = (container.resolve('em') as EntityManager).fork()
    await signalHandler.sendSignal(em, container, {
      instanceId: row.processId,
      signalName: row.signalName ?? EXTERNAL_RUN_RESUME_SIGNAL,
      payload,
      agentOutcome: outcomeHandle,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      ...(args.userId ? { userId: args.userId } : {}),
    })
    return 'sent'
  } catch (error) {
    logger.error('external run settled but the parked workflow step could not be resumed; left parked', {
      externalRunRowId: row.id,
      runId: row.runId,
      agentId: row.agentId,
      processId: row.processId,
      stepId: row.stepId,
      outcomeHandle,
      error: error instanceof Error ? error.message : String(error),
    })
    return 'failed'
  }
}

/**
 * The context payload the resumed step sees.
 *
 * Mirrors the shape core's own activity worker writes for the same three outcomes,
 * key for key, so an author's `{{context.*}}` references read identically whether
 * the agent ran in-process or over a phone line. The engine-owned keys (`__error`,
 * `__guardrailBlock`) are read from core rather than re-spelled here, so a rename
 * there cannot leave this path writing a key nothing routes on.
 *
 * The correlation row carries no `outputMapping` — that lives on the workflow
 * activity config the queue job held — so an external step lands on the LEGACY
 * fixed keys the ledger already advertises as the no-mapping fallback. Threading
 * the mapping through is follow-up work for whoever needs it.
 */
async function buildResumePayload(args: ResumeParkedStepArgs): Promise<Record<string, unknown>> {
  const { row, outcomeHandle } = args
  const stepId = row.stepId as string

  if (outcomeHandle === 'researcher') {
    return {
      disposition: 'researcher',
      agentId: row.agentId,
      [`${stepId}_agent`]: args.data,
    }
  }

  if (outcomeHandle === 'guardrailBlocked') {
    const outcomeRouting = (await import(
      '@open-mercato/core/modules/workflows/lib/outcome-routing'
    )) as typeof import('@open-mercato/core/modules/workflows/lib/outcome-routing')
    return {
      disposition: 'guardrail_blocked',
      agentId: row.agentId,
      // CLASSIFICATION ONLY — never the evidence blob. The guardrail evidence can
      // quote the transcript verbatim, and the run context is readable by every
      // downstream step and by the context PATCH API.
      [outcomeRouting.WORKFLOW_GUARDRAIL_BLOCK_CONTEXT_KEY]: {
        stepId,
        ...(args.failure?.blockedReason ?? {}),
        guardrailSetVersion: GUARDRAIL_SET_VERSION,
      },
    }
  }

  const errorRouting = (await import(
    '@open-mercato/core/modules/workflows/lib/error-routing'
  )) as typeof import('@open-mercato/core/modules/workflows/lib/error-routing')
  return {
    agentId: row.agentId,
    [errorRouting.WORKFLOW_ERROR_CONTEXT_KEY]: errorRouting.buildErrorContextEntry(
      stepId,
      args.failure?.detail ?? '[internal] external agent run failed',
    ),
  }
}
