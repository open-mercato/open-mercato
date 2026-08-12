import { createHash, randomBytes } from 'node:crypto'
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
import { AgentOutputInvalidError, ExternalAgentConfigurationError } from './errors'
import {
  type AgentRunCtx,
  buildCommandContext,
  completeRun,
  createExternalRunRow,
  createRun,
  failRun,
  shapeResult,
} from './persistence'

const logger = createLogger('agent_orchestrator').child({ component: 'external-agent-runner' })

/**
 * Path of the unauthenticated callback route (T2.6 implements it). Declared here
 * because the runner is what hands the URL to the provider: the route and the URL
 * we published must be the same string, and a drift between them is only
 * discovered when a real call comes back to a 404 half an hour later.
 */
export function buildExternalRunCallbackPath(callbackToken: string): string {
  return `/api/agent_orchestrator/external-runs/${encodeURIComponent(callbackToken)}/callback`
}

/**
 * The signal that resumes a parked `INVOKE_AGENT` step. It MUST match the name
 * `lib/disposition/resume.ts` sends and the one core's `WAIT_FOR_SIGNAL` keys on:
 * a suspended external run parks exactly where a human-reviewed proposal parks,
 * and is resumed the same way.
 */
export const EXTERNAL_RUN_RESUME_SIGNAL = 'agent_orchestrator.proposal.ready'

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
 * no result: those belong to the callback (T2.4), because there is nothing to
 * validate yet.
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
    // is born settled and carries no resume triple: the step never parked and
    // resumes on the ordinary returned result.
    const result = await this.settleSynchronousResult({
      agentId,
      entry,
      runId,
      commandCtx,
      payload: started.result,
    })

    await createExternalRunRow(this.commandBus, commandCtx, {
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
      status: 'completed',
      expiresAt,
      requestPayload: input,
      resultPayload: started.result,
    })

    return { kind: 'settled', result }
  }

  /**
   * Settle a run the connector answered synchronously.
   *
   * Deliberately narrow: it validates the payload against the agent's declared
   * OUTCOME envelope and completes the run. It does NOT run the output guardrail
   * (`checkOutput` + `persistVerdict`) — that, together with the single-shot
   * correlation-row transition and the workflow resume, is the completion half
   * (T2.4) and is written once, for both paths, rather than twice. Until T2.4
   * lands, a connector that sets `expectsCallback: false` is schema-checked but
   * not guardrail-screened; no connector ships in this phase, so nothing takes
   * that path yet.
   */
  private async settleSynchronousResult(args: {
    agentId: string
    entry: AgentRegistryEntry
    runId: string
    commandCtx: ReturnType<typeof buildCommandContext>
    payload: unknown
  }): Promise<AgentResult> {
    const { agentId, entry, runId, commandCtx, payload } = args
    const parsed = entry.schema.safeParse(payload)
    if (!parsed.success) {
      await failRun(this.commandBus, commandCtx, { runId, errorMessage: parsed.error.message })
      throw new AgentOutputInvalidError(agentId, parsed.error.message)
    }
    const result = shapeResult(entry.resultKind, parsed.data, agentId)
    await completeRun(this.commandBus, commandCtx, {
      runId,
      output: result,
      resultKind: entry.resultKind,
      // External agents are researcher-kind only, so there is no confidence to
      // derive — the run row renders `—`, honestly.
      confidence: null,
    })
    return result
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

/** Lowercase SHA-256 hex — the only shape `agentExternalRunSchema` accepts. */
export function hashCallbackToken(callbackToken: string): string {
  return createHash('sha256').update(callbackToken).digest('hex')
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
