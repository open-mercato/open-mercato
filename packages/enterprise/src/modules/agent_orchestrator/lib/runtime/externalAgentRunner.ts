import { randomBytes } from 'node:crypto'
import type { AwilixContainer } from 'awilix'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { hasAllFeatures } from '@open-mercato/shared/lib/auth/featureMatch'
import type { AgentRegistryEntry } from '../sdk/defineAgent'
import { type AgentResult } from '../../data/validators'
import {
  getExternalAgentConnector,
  type ExternalAgentConnector,
  type ExternalAgentConnectorScope,
  type ExternalAgentConnectorStartArgs,
} from './externalConnectorRegistry'
import { assembleRunContextSpans, screenRunInput } from './runPreflight'
import { enqueueExternalRunDeadlineSweep } from './externalRunSweep'
import { buildExternalRunCallbackPath, hashCallbackToken } from './callbackToken'
import {
  completeExternalRun,
  EXTERNAL_RUN_RESUME_SIGNAL,
  type CompleteExternalRunResult,
} from './completeExternalRun'
import {
  AgentGuardrailBlockedError,
  AgentOutputInvalidError,
  ExternalAgentConfigurationError,
  ExternalAgentNotPermittedError,
  ExternalAgentSimulationUnavailableError,
} from './errors'
import { getCurrentRunSource } from './runContext'
import { emitExternalRunEvent } from './externalRunEvents'
import { GUARDRAIL_SET_VERSION } from '../guardrails/guardrailService'
import {
  type AgentRunCtx,
  buildCommandContext,
  completeRun,
  createExternalRunRow,
  createRun,
  failRun,
  resolveCallerAcl,
} from './persistence'

const logger = createLogger('agent_orchestrator').child({ component: 'external-agent-runner' })

/**
 * Re-exported from `./callbackToken`, a zero-dependency leaf the unauthenticated
 * callback route can import WITHOUT dragging this whole start path (context
 * assembly, the TDCR bundle resolver, the input guardrail) into the module graph
 * of a publicly reachable route. Keeping the exports here preserves T2.3's import
 * paths — the same compatibility move `EXTERNAL_RUN_RESUME_SIGNAL` makes below.
 */
export { buildExternalRunCallbackPath, hashCallbackToken }

/**
 * Re-exported from `./completeExternalRun`, where the constant now lives with the
 * code that sends the signal. Keeping the export here preserves T2.3's import path
 * (the correlation row's `signal_name` is written by THIS file, so both halves
 * need it) while keeping the dependency one-way: runner → completion.
 */
export { EXTERNAL_RUN_RESUME_SIGNAL }

/**
 * The default-OFF ACL feature that gates outbound contact (design §3 rule 2, risk
 * R6; declared in `acl.ts`). Held here rather than in `acl.ts` so the enforcement
 * point owns the constant and `acl.ts` stays a dependency-free declaration the
 * generators can read; a test asserts the two agree.
 */
export const EXTERNAL_AGENT_INVOKE_FEATURE = 'agent_orchestrator.external_agents.invoke'

/**
 * What one dispatched agent run produced: either a settled `AgentResult` (every
 * in-process runtime, and an external connector that answered inside `start()`)
 * or a SUSPENSION — the external run started, holds no worker slot, and will be
 * settled by a verified provider callback minutes later.
 */
export type AgentRunOutcome =
  | { kind: 'settled'; result: AgentResult }
  | { kind: 'suspended'; runId: string; externalRunId: string }

export type ExternalAgentRunnerDeps = {
  container: AwilixContainer
  commandBus: CommandBus
}

/**
 * An origin whose runs must NEVER place real outbound contact (T3.3).
 *
 * Only `'eval'` today, and it is a UNION rather than a boolean so a second
 * non-production origin (a shadow run, a rehearsal mode) has somewhere truthful to
 * land — and so the refusal can name which one refused rather than saying only
 * "not production".
 *
 * The workflow DRY RUN is deliberately absent, because it never reaches this
 * runner: `INVOKE_AGENT` carries an activity-level `mock` and core's
 * `executeActivity` swaps it in at the one place `entry.execute` is called, so a
 * dry run short-circuits into a would-do long before the agent bridge — covered by
 * core's own `workflows/lib/__tests__/dry-run.test.ts`. Were that ever to change,
 * a dry run would arrive here carrying `source: 'runtime'` and would dial, so the
 * dry-run guarantee genuinely rests on core's branch and not on this one.
 */
export type SimulatedExternalRunSource = 'eval'

/**
 * The origin that requires a simulation, or `null` for real production traffic.
 *
 * TWO signals, both checked, because the refusal must hold even for a caller that
 * forgets to thread the tag: `ctx.source` is what `evalReplayService` sets
 * explicitly, and `getCurrentRunSource()` is the async-scoped origin of the run
 * TREE this call sits inside. Reading both can only ever widen the refusal — the
 * ambient value is `'eval'` only when an eval run is genuinely on the stack — so a
 * false positive would require a production run nested inside a replay, which does
 * not exist.
 */
export function resolveSimulatedExternalRunSource(ctx: AgentRunCtx): SimulatedExternalRunSource | null {
  if (ctx.source === 'eval') return 'eval'
  if (getCurrentRunSource() === 'eval') return 'eval'
  return null
}

/**
 * How this start will proceed, decided before anything is written or dialled.
 *
 * A discriminated union rather than a nullable flag so the two arms cannot be
 * confused: the real arm is the only one holding a `callbackBaseUrl`, and the
 * simulated arm is the only one holding a `mock`. There is no state in which the
 * runner has both.
 */
type ExternalStartMode =
  | { simulated: false; callbackBaseUrl: string }
  | {
      simulated: true
      source: SimulatedExternalRunSource
      mock: (args: ExternalAgentConnectorStartArgs) => unknown
    }

/**
 * The inner `kind` of a simulated external run's payload.
 *
 * Deliberately NOT a value from the runtime outcome vocabulary, following
 * `buildInvokeAgentWouldDo`'s rule: nothing downstream may mistake a simulation
 * for something that happened.
 */
export const SIMULATED_EXTERNAL_RUN_KIND = 'would_start_external_run'

/**
 * What a simulated start hands the connector's `mock` in place of a live callback
 * URL and single-use bearer.
 *
 * A simulation MUST NOT mint a real credential. The token is the only proof on an
 * unauthenticated public route, nothing will ever post to the URL, and a `mock`
 * that echoed either into its would-do payload would write a live bearer into an
 * eval case that is then stored, listed and read by operators.
 */
const SIMULATED_CALLBACK_URL = 'simulated://external-run-callback'
const SIMULATED_CALLBACK_TOKEN = 'simulated-no-callback-token-is-minted'

/**
 * Wrap a connector's would-do payload in an envelope that cannot be mistaken for
 * an answer.
 *
 * The connector's payload is NESTED under `wouldDo`, never spread at the top
 * level, and that nesting is the load-bearing part. A badly-written `mock` that
 * returned `{ reached: true, transcript: '…' }` — the exact shape of the driving
 * use case's real outcome — still cannot produce something that reads as the
 * agent's outcome, because the outcome fields are one level down from where any
 * reader of a researcher result looks. The platform therefore never synthesises an
 * answer on a connector's behalf even when the connector tries to.
 */
function buildSimulatedExternalRunResult(args: {
  agentId: string
  connectorId: string
  source: SimulatedExternalRunSource
  wouldDo: unknown
}): AgentResult {
  return {
    kind: 'researcher',
    data: {
      simulated: true,
      started: false,
      kind: SIMULATED_EXTERNAL_RUN_KIND,
      source: args.source,
      agentId: args.agentId,
      connectorId: args.connectorId,
      wouldDo: args.wouldDo,
    },
  }
}

/**
 * The `external` runtime (external-agent-invocation design §5.2): the START half
 * of an agent that runs at a third party and answers out of band.
 *
 * It keeps the `NativeAgentRunner` front half verbatim — open the audited
 * `AgentRun`, assemble the TDCR context bundle, screen the assembled spans
 * through the PRE-CALL input guardrail — and replaces the model call with
 * `connector.start(...)`. Then it stops. No output guardrail, no `completeRun`,
 * no result: those belong to `./completeExternalRun`, because there is nothing to
 * validate yet. The one exception is a connector that answers inside `start()` —
 * it has an answer immediately, so it goes straight through that same completion
 * function rather than a second, laxer path of its own.
 *
 * The input guardrail matters MORE here than in the native path. In-process it
 * screens what we are about to feed our own model; here it screens the brief we
 * are about to hand to a third party and, in the driving case, read aloud down a
 * phone line. A `block` therefore fails the run before anything leaves the
 * building — `connector.start` is never reached.
 */
export class ExternalAgentRunner {
  private readonly container: AwilixContainer
  private readonly commandBus: CommandBus

  constructor(deps: ExternalAgentRunnerDeps) {
    this.container = deps.container
    this.commandBus = deps.commandBus
  }

  async run(
    agentId: string,
    entry: AgentRegistryEntry,
    input: unknown,
    ctx: AgentRunCtx,
  ): Promise<AgentRunOutcome> {
    // GOVERNANCE BEFORE WIRING. Outbound contact is the one thing this runtime
    // does that no other runtime does, and it is regulated — so the authorization
    // question is answered before the deployment-configuration questions below,
    // and long before anything is written or dialled. See
    // `ExternalAgentNotPermittedError` for why this is a feature of its own rather
    // than a reuse of `agents.run`.
    await this.assertOutboundContactPermitted(agentId, ctx)

    // Resolve the connector FIRST, before any row exists. A connector is
    // registered from a provider module's `di.ts` while the agent is registered
    // from `ai-agents.ts`; the two are independent by design, so `connectorId`
    // cannot be validated at registration and the check lands here. A missing one
    // is a deployment mistake — the provider package is absent or its `di.ts`
    // never ran — so it refuses in the same place and the same way an unknown
    // agent id does, leaving no failed run against an agent that never executed.
    const connector = this.resolveConnector(agentId, entry)

    // SIMULATION GATE (T3.3), answered second — after authorization and before
    // every deployment-configuration question, because "may this run dial at all"
    // outranks "is this deployment wired to dial correctly".
    //
    // This is the structural half of the "no mock means refuse" convention the
    // connector registry documents. Before this, nothing read `connector.mock`:
    // the runner dialled unconditionally, and `lib/eval/evalReplayService.ts`
    // calls `agentRuntime.run()` for real, so a fifty-case suite replayed against
    // a voice agent placed fifty real phone calls. The convention was held closed
    // only by the ElevenLabs connector happening to omit `mock` — which did
    // nothing — so the guarantee is moved here, where the dialling is.
    const mode = this.resolveStartMode(agentId, connector, ctx)
    const callbackTimeoutMs = this.resolveCallbackTimeoutMs(agentId, entry)

    const commandCtx = buildCommandContext(this.container, ctx)

    const runId = await createRun(this.commandBus, commandCtx, {
      source: ctx.source,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      agentId,
      input,
      parentRunId: ctx.parentRunId ?? null,
      runtime: 'external',
      // `externalRunId = runId`, exactly like the native path — NOT the provider's
      // run id, despite what design §5.2's table proposed. Two reasons, both
      // discovered against the live schema:
      //   1. The provider id is not known yet. It arrives from `start()`, after
      //      this row must already exist so a failing start has something to fail.
      //   2. `agent_runs_runtime_external_uq` is unique on `(runtime,
      //      external_run_id)` with NO tenancy column. A provider run id is unique
      //      per provider ACCOUNT, not globally, so two tenants on their own
      //      ElevenLabs workspaces can legitimately mint the same `conversation_id`
      //      — and the second tenant's run would then be rejected by a database
      //      constraint that has nothing to do with it. This is precisely why T2.1
      //      scoped `agent_external_runs.external_run_id` by organization instead.
      // The provider id therefore lives on the correlation row, under that
      // org-scoped unique, and this column keeps the collision-free uuid we minted
      // so the trace-ingest idempotency key stays meaningful.
      stampExternalRunIdFromId: true,
      model: entry.defaultModel ?? null,
      processId: ctx.processId ?? null,
      stepId: ctx.stepId ?? null,
      agentType: entry.agentType ?? null,
    })

    if (ctx.onRunPersisted) {
      try {
        ctx.onRunPersisted(runId)
      } catch (err) {
        logger.warn('onRunPersisted hook failed', {
          agentId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    const { untrustedSpans } = await assembleRunContextSpans({
      container: this.container,
      agentId,
      runId,
      ctx,
    })
    await screenRunInput({
      container: this.container,
      commandBus: this.commandBus,
      commandCtx,
      agentId,
      runId,
      ctx,
      untrustedSpans,
    })

    // The simulated arm returns HERE — after the audited run row and the pre-call
    // input guardrail, before the callback token is minted and before the
    // connector is touched. Everything except the dial still happens, deliberately:
    // an eval that skipped the guardrail would measure a different configuration
    // from the one production runs, which is exactly the regression signal the eval
    // plane exists to protect. Nothing below this line executes, so there is no
    // `agent_external_runs` correlation row, no deadline job and no callback
    // surface for a run that never left the building.
    if (mode.simulated) {
      const result = await this.settleSimulatedRun({
        agentId,
        entry,
        connectorId: connector.id,
        mode,
        input,
        runId,
        commandCtx,
        ctx,
      })
      return { kind: 'settled', result }
    }

    // Single-use bearer for the callback route: 256 bits of CSPRNG randomness,
    // hex-encoded behind a readable prefix — the same shape and the same source
    // (`node:crypto` `randomBytes`) as the OpenCode runner's per-run session
    // token, widened because this one is the ONLY credential on an
    // unauthenticated public route. The plaintext goes to the provider and is
    // never persisted; only its digest is.
    const callbackToken = mintCallbackToken()
    const callbackUrl = `${mode.callbackBaseUrl}${buildExternalRunCallbackPath(callbackToken)}`
    const scope: ExternalAgentConnectorScope = {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    }

    let started: Awaited<ReturnType<ExternalAgentConnector['start']>>
    try {
      started = await connector.start({
        agentEntry: entry,
        input,
        callbackUrl,
        callbackToken,
        scope,
      })
    } catch (err) {
      // The provider refused or was unreachable: nothing is in flight, so fail
      // the audit row and propagate. The workflow's own error handling (T1.2's
      // absorbable path) then sees a real activity failure rather than a step
      // silently parked on a call that was never placed.
      const message = err instanceof Error ? err.message : String(err)
      await failRun(this.commandBus, commandCtx, { runId, errorMessage: message })
      throw err
    }

    const hasWorkflowStep = Boolean(ctx.processId && ctx.stepId)
    const expiresAt = new Date(Date.now() + callbackTimeoutMs)

    if (started.expectsCallback) {
      const externalRunRowId = await createExternalRunRow(this.commandBus, commandCtx, {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        runId,
        agentId,
        connectorId: connector.id,
        callbackTokenHash: hashCallbackToken(callbackToken),
        externalRunId: started.externalRunId,
        // All three or none — a row naming a step but no process could never be
        // resumed and would park the instance forever (T2.1's invariant).
        processId: hasWorkflowStep ? ctx.processId : null,
        stepId: hasWorkflowStep ? ctx.stepId : null,
        signalName: hasWorkflowStep ? EXTERNAL_RUN_RESUME_SIGNAL : null,
        // Snapshotted alongside the triple, and gated on it for the same reason:
        // a mapping describes where the answer lands in a parked step's context,
        // so it means nothing without one. This is the whole point of T2.11 — the
        // callback settles in another process, minutes later, with no queue job
        // left to carry the author's `{ call: 'data.transcript' }`.
        outputMapping: hasWorkflowStep ? ctx.outputMapping ?? null : null,
        status: 'pending',
        expiresAt,
        requestPayload: input,
      })

      // The deadline (T2.7). Enqueued AFTER the row exists, because the job
      // addresses that row, and swallowing its own failures because at this point
      // the call is already live — see `enqueueExternalRunDeadlineSweep`. The
      // periodic per-organization sweep is the self-healing backstop for
      // everything this delayed job can lose.
      await enqueueExternalRunDeadlineSweep({
        externalRunRowId,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        runId,
        expiresAt,
      })

      logger.info('external agent run started; suspending until the provider calls back', {
        agentId,
        runId,
        connectorId: connector.id,
        externalRunId: started.externalRunId,
        expiresAt: expiresAt.toISOString(),
      })

      // Announced AFTER the row and the deadline exist, so nothing can observe a
      // started external run that has no correlation row to settle it and no
      // deadline to release it. Best-effort by contract — the call is already live,
      // so a failing event bus must never turn a placed call into a failed run.
      await emitExternalRunEvent('agent_orchestrator.external_run.started', {
        externalRunRowId,
        runId,
        agentId,
        connectorId: connector.id,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        externalRunId: started.externalRunId,
        processId: hasWorkflowStep ? ctx.processId : null,
        stepId: hasWorkflowStep ? ctx.stepId : null,
      })

      return { kind: 'suspended', runId, externalRunId: started.externalRunId }
    }

    // The connector answered inside `start()`. Nothing will call back, so the row
    // carries no resume triple — the step never parked and resumes on the ordinary
    // returned result.
    //
    // It is still born `pending` and settled through `completeExternalRun`, rather
    // than written pre-settled. That routes the synchronous arm through the SAME
    // output guardrail, the same audit ordering and the same single-shot claim the
    // callback arm uses — closing the gap T2.3 left open, where an
    // `expectsCallback: false` connector was schema-checked but never
    // guardrail-screened. One extra UPDATE is a small price for one completion
    // path instead of two that will drift.
    const externalRunRowId = await createExternalRunRow(this.commandBus, commandCtx, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      runId,
      agentId,
      connectorId: connector.id,
      callbackTokenHash: hashCallbackToken(callbackToken),
      externalRunId: started.externalRunId,
      processId: null,
      stepId: null,
      signalName: null,
      // Nothing parked, so nothing to map into: this arm returns its result to the
      // caller still on the stack, and the workflow worker applies the mapping
      // itself exactly as it does for every in-process runtime.
      outputMapping: null,
      status: 'pending',
      expiresAt,
      requestPayload: input,
    })

    // The synchronous arm announces the SAME pair as the suspended one: this run
    // also started at a third party, it simply finished before we returned.
    // `completeExternalRun` below emits its terminal half, so an operator reading
    // the event log sees one shape for both kinds of connector.
    await emitExternalRunEvent('agent_orchestrator.external_run.started', {
      externalRunRowId,
      runId,
      agentId,
      connectorId: connector.id,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      externalRunId: started.externalRunId,
      processId: null,
      stepId: null,
    })

    const settled = await completeExternalRun({
      container: this.container,
      commandBus: this.commandBus,
      entry,
      row: {
        id: externalRunRowId,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        runId,
        agentId,
        connectorId: connector.id,
        processId: null,
        stepId: null,
        signalName: null,
        // Stated rather than left to be read back: this row was written two
        // statements ago with no mapping, and nothing parked behind it to map into.
        outputMapping: null,
      },
      scope: { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
      settlement: { kind: 'result', payload: started.result },
      userId: ctx.userId,
    })

    if (settled.status === 'completed') return { kind: 'settled', result: settled.result }
    throw this.synchronousSettlementError(agentId, runId, settled)
  }

  /**
   * Turn a non-`completed` settlement of a SYNCHRONOUS connector back into the
   * typed error this call surface has always thrown.
   *
   * The caller here is an ordinary `agentRuntime.run()` / `runOrSuspend()` caller
   * that is still on the stack, so a failure must reach it as an exception — the
   * return-value reporting `completeExternalRun` uses exists for the callback
   * route, which has no such caller. The error classes are the ones the native
   * runner raises for the same two conditions, so a workflow's structural
   * guardrail-block recognition (`isGuardrailBlockedError`) keeps working
   * unchanged for a synchronous external agent.
   */
  private synchronousSettlementError(
    agentId: string,
    runId: string,
    settled: CompleteExternalRunResult,
  ): Error {
    if (settled.status === 'failed') {
      if (settled.blockedReason) {
        return new AgentGuardrailBlockedError(agentId, settled.detail, {
          phase: settled.blockedReason.phase,
          kind: settled.blockedReason.kind,
          guardrailSetVersion: GUARDRAIL_SET_VERSION,
        })
      }
      return new AgentOutputInvalidError(agentId, settled.detail)
    }
    // `already_settled` / `scope_denied` are unreachable on this path: the row was
    // created `pending` two statements ago, under this run's own scope. Reaching
    // them means the correlation row is not the one we just wrote, which is a bug,
    // not a provider behaviour — so it says exactly that rather than pretending the
    // run produced something.
    return new AgentOutputInvalidError(
      agentId,
      `[internal] synchronous external settlement returned "${settled.status}" for run ${runId}`,
    )
  }

  /**
   * Decide whether this start dials for real or is simulated — and refuse
   * outright when it must be simulated and cannot be.
   *
   * Runs BEFORE the run row opens, so a refusal leaves nothing behind, on the same
   * "nothing was attempted" rule the ACL and configuration refusals follow. The
   * real arm resolves the callback base URL here rather than later for the reason
   * `resolveCallbackBaseUrl` documents; the simulated arm never resolves it at all,
   * since refusing an eval replay because production `APP_URL` is unset would be a
   * deployment report standing in for a safety answer.
   *
   * `mock` is bound to its connector so an implementation written as a class method
   * keeps its `this`.
   */
  private resolveStartMode(
    agentId: string,
    connector: ExternalAgentConnector,
    ctx: AgentRunCtx,
  ): ExternalStartMode {
    const source = resolveSimulatedExternalRunSource(ctx)
    if (!source) return { simulated: false, callbackBaseUrl: resolveCallbackBaseUrl(agentId) }

    const mock = connector.mock
    if (!mock) {
      // As with the ACL refusal, no run row exists to carry this, so the log line
      // is the only record. It names the agent, the connector and the scope —
      // never the input, which is the brief that would have been read aloud.
      logger.warn('refused an external agent run: it cannot be simulated and must not dial', {
        agentId,
        connectorId: connector.id,
        source,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
      })
      throw new ExternalAgentSimulationUnavailableError(agentId, connector.id, source)
    }
    return { simulated: true, source, mock: mock.bind(connector) }
  }

  /**
   * Complete a simulated external run from the connector's would-do payload.
   *
   * The payload is NOT validated against the agent's declared outcome envelope,
   * and that is the point: a would-do is a description of the call that was not
   * placed, not an outcome, so validating it would force every connector to
   * fabricate an answer in the declared shape — precisely what the platform
   * refuses to do. It is wrapped by {@link buildSimulatedExternalRunResult} instead,
   * which puts it a level below where any reader of a researcher result looks.
   *
   * `resultKind: 'researcher'` because external agents are researcher-only in this
   * pass (design decision: an external PROPOSAL agent would let a third party's
   * confidence auto-approve a domain write).
   */
  private async settleSimulatedRun(args: {
    agentId: string
    entry: AgentRegistryEntry
    connectorId: string
    mode: Extract<ExternalStartMode, { simulated: true }>
    input: unknown
    runId: string
    commandCtx: CommandRuntimeContext
    ctx: AgentRunCtx
  }): Promise<AgentResult> {
    let wouldDo: unknown
    try {
      wouldDo = args.mode.mock({
        agentEntry: args.entry,
        input: args.input,
        callbackUrl: SIMULATED_CALLBACK_URL,
        callbackToken: SIMULATED_CALLBACK_TOKEN,
        scope: { tenantId: args.ctx.tenantId, organizationId: args.ctx.organizationId },
      })
    } catch (err) {
      // A throwing `mock` is a connector defect, and it is reported as one rather
      // than degraded into a refusal: the run fails, the eval case records why, and
      // nobody is left believing the agent was exercised.
      const message = err instanceof Error ? err.message : String(err)
      await failRun(this.commandBus, args.commandCtx, {
        runId: args.runId,
        errorMessage: `[internal] the connector's mock threw while simulating an external run: ${message}`,
      })
      throw err
    }

    const result = buildSimulatedExternalRunResult({
      agentId: args.agentId,
      connectorId: args.connectorId,
      source: args.mode.source,
      wouldDo,
    })
    await completeRun(this.commandBus, args.commandCtx, {
      runId: args.runId,
      output: result,
      resultKind: 'researcher',
    })

    logger.info('external agent run simulated; no outbound contact was placed', {
      agentId: args.agentId,
      runId: args.runId,
      connectorId: args.connectorId,
      source: args.mode.source,
    })
    return result
  }

  /**
   * Refuse an external run whose principal may not place outbound contact.
   *
   * `resolveCallerAcl` is the same helper `NativeAgentRunner` uses to give an
   * agent's tools the CALLER's grants rather than escalated ones, and it FAILS
   * CLOSED by construction: an unresolvable RBAC service, an unknown user or an
   * empty user id all yield `{ features: [], isSuperAdmin: false }`, which denies.
   * That matters here more than anywhere else in the module — the failure mode of
   * a fail-open gate is an unauthorized phone call to a real person.
   *
   * Wildcard-aware through the shared `hasAllFeatures`, so `agent_orchestrator.*`
   * and `*` grants satisfy it exactly as they do everywhere else; `isSuperAdmin`
   * short-circuits for the same reason every other feature gate honours it.
   */
  private async assertOutboundContactPermitted(agentId: string, ctx: AgentRunCtx): Promise<void> {
    const acl = await resolveCallerAcl(this.container, ctx)
    if (acl.isSuperAdmin) return
    if (hasAllFeatures([EXTERNAL_AGENT_INVOKE_FEATURE], acl.features)) return

    // The refusal leaves no run row (nothing was attempted), so the log line is the
    // only record a tenant has of an attempted outbound contact. It therefore names
    // the principal and the scope — never the input, which is the brief.
    logger.warn('refused an external agent run: the principal may not place outbound contact', {
      agentId,
      userId: ctx.userId || null,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      processId: ctx.processId ?? null,
      stepId: ctx.stepId ?? null,
      requiredFeature: EXTERNAL_AGENT_INVOKE_FEATURE,
    })
    throw new ExternalAgentNotPermittedError(agentId, EXTERNAL_AGENT_INVOKE_FEATURE)
  }

  private resolveConnector(agentId: string, entry: AgentRegistryEntry): ExternalAgentConnector {
    const connectorId = entry.connectorId?.trim()
    if (!connectorId) {
      throw new ExternalAgentConfigurationError(
        agentId,
        'connector_not_declared',
        'the registry entry declares runtime "external" but names no connectorId',
      )
    }
    const connector = getExternalAgentConnector(connectorId)
    if (!connector) {
      throw new ExternalAgentConfigurationError(
        agentId,
        'connector_missing',
        `no external agent connector is registered under id "${connectorId}"`,
      )
    }
    return connector
  }

  private resolveCallbackTimeoutMs(agentId: string, entry: AgentRegistryEntry): number {
    const timeoutMs = entry.callbackTimeoutMs
    if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new ExternalAgentConfigurationError(
        agentId,
        'deadline_missing',
        'the registry entry carries no positive callbackTimeoutMs; a call nobody answers would park the workflow forever',
      )
    }
    if (timeoutMs > IMPLAUSIBLE_CALLBACK_TIMEOUT_MS) {
      // WARN, NOT REFUSE. `callbackTimeoutMs` has no upper bound (T2.2), and
      // capping one here would fail runs an author deliberately configured — a
      // multi-day external agent is unusual, not invalid, and this runner is the
      // wrong place to overrule the registry. What IS worth saying out loud is
      // that the guarantee weakens past this point: the delayed deadline job has
      // to survive in the queue backend for the whole window, and days of Redis
      // or `.mercato/queue` retention across deploys is not something to rely on.
      // Such a run leans entirely on the periodic sweep — which is another reason
      // both halves ship. One line per run is affordable: external runs place
      // real-world calls, so they are low-volume by nature.
      logger.warn('external agent declares an implausibly long callback deadline', {
        agentId,
        callbackTimeoutMs: timeoutMs,
        thresholdMs: IMPLAUSIBLE_CALLBACK_TIMEOUT_MS,
      })
    }
    return timeoutMs
  }
}

/**
 * Above 24 hours a deadline stops being a deadline and starts being a leak. The
 * driving use case is a phone call measured in minutes, and no plausible external
 * agent parks a business process for longer than a day without somebody wanting
 * to know.
 */
const IMPLAUSIBLE_CALLBACK_TIMEOUT_MS = 24 * 60 * 60 * 1000

function mintCallbackToken(): string {
  return `xrun_${randomBytes(32).toString('hex')}`
}

/**
 * Absolute base URL the provider posts its callback to.
 *
 * Reuses the platform's existing `APP_URL` / `NEXT_PUBLIC_APP_URL` convention —
 * the same pair core's `buildApiUrl` (CALL_API), the notifications delivery
 * config and the security-email links read — rather than adding a connector-only
 * env var nobody would remember to set.
 *
 * The localhost fallback that `buildApiUrl` accepts is NOT acceptable here, and
 * the asymmetry is deliberate: `buildApiUrl` calls back into this same process,
 * where localhost is correct. This URL is handed to a third party on the public
 * internet, so an unset `APP_URL` in production would place a real phone call
 * that can never report its result — the workflow then parks until the deadline
 * sweep expires it, half an hour later, for a misconfiguration that was knowable
 * before we dialled. Refusing outside development is what turns that into an
 * immediate, legible failure. Resolution happens BEFORE the run row is opened, so
 * a misconfigured deployment never places the call at all.
 */
function resolveCallbackBaseUrl(agentId: string): string {
  const configured = (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? '').trim()
  if (configured) return configured.replace(/\/+$/, '')
  if (process.env.NODE_ENV === 'production') {
    throw new ExternalAgentConfigurationError(
      agentId,
      'callback_base_url_missing',
      'APP_URL is not configured, so the provider would be handed a callback URL it cannot reach',
    )
  }
  return 'http://localhost:3000'
}
