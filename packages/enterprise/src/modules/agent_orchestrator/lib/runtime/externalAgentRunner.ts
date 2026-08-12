import { randomBytes } from 'node:crypto'
import type { AwilixContainer } from 'awilix'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { AgentRegistryEntry } from '../sdk/defineAgent'
import { type AgentResult } from '../../data/validators'
import {
  getExternalAgentConnector,
  type ExternalAgentConnector,
  type ExternalAgentConnectorScope,
} from './externalConnectorRegistry'
import { assembleRunContextSpans, screenRunInput } from './runPreflight'
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
} from './errors'
import { GUARDRAIL_SET_VERSION } from '../guardrails/guardrailService'
import {
  type AgentRunCtx,
  buildCommandContext,
  createExternalRunRow,
  createRun,
  failRun,
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
    // Resolve the connector FIRST, before any row exists. A connector is
    // registered from a provider module's `di.ts` while the agent is registered
    // from `ai-agents.ts`; the two are independent by design, so `connectorId`
    // cannot be validated at registration and the check lands here. A missing one
    // is a deployment mistake — the provider package is absent or its `di.ts`
    // never ran — so it refuses in the same place and the same way an unknown
    // agent id does, leaving no failed run against an agent that never executed.
    const connector = this.resolveConnector(agentId, entry)
    const callbackTimeoutMs = this.resolveCallbackTimeoutMs(agentId, entry)
    const callbackBaseUrl = resolveCallbackBaseUrl(agentId)

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

    // Single-use bearer for the callback route: 256 bits of CSPRNG randomness,
    // hex-encoded behind a readable prefix — the same shape and the same source
    // (`node:crypto` `randomBytes`) as the OpenCode runner's per-run session
    // token, widened because this one is the ONLY credential on an
    // unauthenticated public route. The plaintext goes to the provider and is
    // never persisted; only its digest is.
    const callbackToken = mintCallbackToken()
    const callbackUrl = `${callbackBaseUrl}${buildExternalRunCallbackPath(callbackToken)}`
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
      await createExternalRunRow(this.commandBus, commandCtx, {
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
        status: 'pending',
        expiresAt,
        requestPayload: input,
      })

      logger.info('external agent run started; suspending until the provider calls back', {
        agentId,
        runId,
        connectorId: connector.id,
        externalRunId: started.externalRunId,
        expiresAt: expiresAt.toISOString(),
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
      status: 'pending',
      expiresAt,
      requestPayload: input,
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
    return timeoutMs
  }
}

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
