import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import {
  createSessionApiKey,
  deleteSessionApiKey,
  generateSessionToken,
} from '@open-mercato/core/modules/api_keys/services/apiKeyService'
import { UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { emitAgentOrchestratorEvent } from '../../events'
import type { AgentRegistryEntry } from '../sdk/defineAgent'
import {
  type AgentResult,
  type CitableSource,
  type GuardResults,
  type GuardrailSetBody,
  type UntrustedSpan,
} from '../../data/validators'
import { deriveEnvelopeConfidence } from '../../data/proposalEnvelope'
import { GuardrailService, GUARDRAIL_SET_VERSION, persistVerdict } from '../guardrails/guardrailService'
import { resolveCurrentGroundingSet } from '../guardrails/syncGroundingSets'
import { ContextModuleNotFoundError, ContextResolverImpl } from '../context/contextResolver'
import { resolveContextModule } from '../context/registry'
import {
  AgentGuardrailBlockedError,
  AgentOutputInvalidError,
  AgentRunTimeoutError,
} from './errors'
import type { AgentRunSessionStore } from './agentRunSessionStore'
import {
  type AgentRunCtx,
  buildCommandContext,
  completeRun,
  createProposal,
  createRun,
  failRun,
  shapeResult,
} from './persistence'
import { DEFAULT_CONTEXT_TOKEN_BUDGET } from './nativeAgentRunner'
import { computeCostMinor } from './modelPricing'
import {
  captureNativeRunTrace,
  isNativeTraceCaptureEnabled,
  type NativeStepRecord,
  type NativeStepToolCall,
} from './nativeTraceCapture'
import {
  BUSINESS_HARNESS_CAPABILITY_AUDIENCE,
  BUSINESS_HARNESS_CAPABILITY_BINDING_ID,
  compileBusinessHarnessBundle,
  prepareBusinessHarnessAgent,
  type BusinessHarnessLoopSettings,
} from './businessHarnessBundle'
import {
  createBusinessHarnessTransport,
  type BusinessHarnessTransport,
} from './businessHarnessTransport'
import type { BusinessHarnessRunEvent, BusinessHarnessRunResult } from './businessHarnessContracts'
import { issueBusinessHarnessRunGrant } from './businessHarnessGrant'
import { resolveBusinessHarnessModel } from './businessHarnessModel'

const logger = createLogger('agent_orchestrator').child({ component: 'business-harness-agent-runner' })

const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_MAX_STEPS = 8
const DEFAULT_MAX_TOOL_CALLS = 40
const MAX_TIMEOUT_MS = 120_000
const MAX_STEPS = 12
const MAX_TOOL_CALLS = 40
const GRANT_MARGIN_MS = 30_000

export type BusinessHarnessAgentRunnerDeps = {
  container: AwilixContainer
  commandBus: CommandBus
  transport?: BusinessHarnessTransport
}

/**
 * Runs a registered OM agent in the standalone business harness. OM remains
 * authoritative for model selection, tenant policy, MCP scope, guardrails and
 * persistence. The harness receives one immutable bundle and short-lived run
 * grant, then returns a schema-constrained result over NDJSON.
 */
export class BusinessHarnessAgentRunner {
  private readonly container: AwilixContainer
  private readonly commandBus: CommandBus
  private readonly transport: BusinessHarnessTransport

  constructor(deps: BusinessHarnessAgentRunnerDeps) {
    this.container = deps.container
    this.commandBus = deps.commandBus
    this.transport = deps.transport ?? createBusinessHarnessTransport()
  }

  async run(entry: AgentRegistryEntry, input: unknown, ctx: AgentRunCtx): Promise<AgentResult> {
    const agentId = entry.id
    const commandCtx = buildCommandContext(this.container, ctx)
    const runId = await createRun(this.commandBus, commandCtx, {
      source: ctx.source,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      agentId,
      input,
      parentRunId: ctx.parentRunId ?? null,
      runtime: 'business-harness',
      stampExternalRunIdFromId: true,
      model: entry.defaultModel ?? null,
      processId: ctx.processId ?? null,
      stepId: ctx.stepId ?? null,
      agentType: entry.agentType ?? null,
    })

    this.notifyRunPersisted(ctx, runId, agentId)

    const em = this.container.resolve<EntityManager>('em')
    const store = this.container.resolve('agentRunSessionStore') as AgentRunSessionStore
    let sessionToken: string | null = null
    let sessionOpened = false
    let runSettled = false
    let modelStartedAtMs: number | null = null
    let resolvedModelId: string | null = entry.defaultModel ?? null
    let terminalResult: BusinessHarnessRunResult | null = null
    const stepRecords: NativeStepRecord[] = []
    const pendingToolCalls = new Map<string, { startedAtMs: number; call: NativeStepToolCall }>()

    const usageStamp = () => {
      const inputTokens = terminalResult?.usage.inputTokens ?? sumUsage(stepRecords, 'inputTokens')
      const outputTokens = terminalResult?.usage.outputTokens ?? sumUsage(stepRecords, 'outputTokens')
      const cost = computeCostMinor(resolvedModelId, inputTokens, outputTokens)
      return {
        ...(inputTokens != null ? { inputTokens } : {}),
        ...(outputTokens != null ? { outputTokens } : {}),
        ...(cost ? { costMinor: cost.costMinor, currency: cost.currency } : {}),
      }
    }
    const failOnce = async (message: string): Promise<void> => {
      if (runSettled) return
      runSettled = true
      await failRun(this.commandBus, commandCtx, { runId, errorMessage: message, ...usageStamp() })
    }
    const scheduleTraceCapture = (): void => {
      if (!isNativeTraceCaptureEnabled() || modelStartedAtMs == null) return
      flushPendingToolCalls(stepRecords, pendingToolCalls, resolvedModelId)
      void captureNativeRunTrace(
        this.container,
        { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
        {
          runtime: 'business-harness',
          runId,
          agentId,
          steps: stepRecords,
          startedAtMs: modelStartedAtMs,
          endedAtMs: Date.now(),
          fallbackUsage: terminalResult?.usage ?? null,
          fallbackModel: resolvedModelId,
        },
      ).catch((error: unknown) => {
        logger.warn('business harness trace capture rejected', {
          runId,
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }

    try {
      const { untrustedSpans, citableSources } = await this.assembleContext(agentId, runId, ctx)
      await this.enforceInputGuardrail(agentId, runId, ctx, untrustedSpans, failOnce)

      const model = await resolveBusinessHarnessModel(this.container, entry, ctx)
      resolvedModelId = model.binding.modelId
      const loop = resolveLoopSettings(entry, ctx, model.loopOverride)
      const prepared = prepareBusinessHarnessAgent(entry)

      sessionToken = generateSessionToken()
      const userRoleIds = await this.getUserRoleIds(em, ctx.userId, ctx.tenantId)
      await createSessionApiKey(em, {
        sessionToken,
        userId: ctx.userId,
        userRoles: userRoleIds,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        ttlMinutes: Math.max(2, Math.ceil((loop.timeoutMs + GRANT_MARGIN_MS) / 60_000)),
      })
      await store.open({
        sessionToken,
        agentId,
        runId,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
      })
      sessionOpened = true

      const grant = issueBusinessHarnessRunGrant({
        runId,
        agentId,
        agentDigest: prepared.digest,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        model: {
          audience: model.credentialAudience,
          bindingId: model.binding.credentialBindingId,
          providerId: model.providerId,
        },
        capability: {
          audience: BUSINESS_HARNESS_CAPABILITY_AUDIENCE,
          bindingId: BUSINESS_HARNESS_CAPABILITY_BINDING_ID,
          sessionToken,
        },
        ttlMs: loop.timeoutMs + GRANT_MARGIN_MS,
      })
      const compiled = compileBusinessHarnessBundle({
        runId,
        entry,
        businessInput: input,
        model: model.binding,
        runGrant: grant.token,
        loop,
        runtimeProfile: 'business-v1',
        prepared,
      })

      modelStartedAtMs = Date.now()
      const outerDeadline = AbortSignal.timeout(loop.timeoutMs + 10_000)
      terminalResult = await this.transport.run(compiled.bundle, {
        signal: outerDeadline,
        onEvent: (event) =>
          this.consumeEvent(event, {
            runId,
            agentId,
            ctx,
            modelId: model.binding.modelId,
            stepRecords,
            pendingToolCalls,
          }),
      })
      assertResultIdentity(terminalResult, compiled.bundle)

      const { parsed, guardResults } = await this.enforceOutputGuardrail({
        entry,
        agentId,
        runId,
        ctx,
        rawOutput: terminalResult.output,
        allowedTools: compiled.tools,
        citableSources,
        failOnce,
      })
      const result = shapeResult(entry.resultKind, parsed, agentId)
      await completeRun(this.commandBus, commandCtx, {
        runId,
        output: result,
        resultKind: entry.resultKind,
        confidence: result.kind === 'proposal' ? deriveEnvelopeConfidence(result.proposal) : null,
        ...usageStamp(),
      })
      runSettled = true
      if (result.kind === 'proposal') {
        await createProposal(this.commandBus, commandCtx, {
          source: ctx.source,
          tenantId: ctx.tenantId,
          organizationId: ctx.organizationId,
          agentId,
          runId,
          payload: result.proposal,
          confidence: deriveEnvelopeConfidence(result.proposal),
          processId: ctx.processId ?? null,
          stepId: ctx.stepId ?? null,
          guardResults,
        })
      }
      scheduleTraceCapture()
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await failOnce(message)
      scheduleTraceCapture()
      if (isHarnessTimeout(error)) throw new AgentRunTimeoutError(agentId, resolveTimeoutFromContext(ctx))
      throw error
    } finally {
      if (sessionToken && sessionOpened) {
        try {
          await store.dispose(sessionToken)
        } catch (error) {
          logger.warn('failed to dispose business harness run session', {
            runId,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
      if (sessionToken) {
        try {
          await deleteSessionApiKey(em, sessionToken)
        } catch (error) {
          logger.warn('failed to revoke business harness session token', {
            runId,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }
  }

  private notifyRunPersisted(ctx: AgentRunCtx, runId: string, agentId: string): void {
    if (!ctx.onRunPersisted) return
    try {
      ctx.onRunPersisted(runId)
    } catch (error) {
      logger.warn('onRunPersisted hook failed', {
        agentId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private async assembleContext(
    agentId: string,
    runId: string,
    ctx: AgentRunCtx,
  ): Promise<{ untrustedSpans: UntrustedSpan[]; citableSources: CitableSource[] }> {
    if (!resolveContextModule(agentId)) return { untrustedSpans: [], citableSources: [] }
    try {
      const resolver = new ContextResolverImpl(this.container)
      const assembled = await resolver.assemble(
        (this.container.resolve('em') as EntityManager).fork(),
        {
          tenantId: ctx.tenantId,
          organizationId: ctx.organizationId,
          agentRunId: runId,
          processId: ctx.processId ?? null,
          stepId: ctx.stepId ?? null,
          capability: agentId,
          budget: DEFAULT_CONTEXT_TOKEN_BUDGET,
        },
      )
      return {
        untrustedSpans: assembled.untrustedSpans,
        citableSources: assembled.citableSources,
      }
    } catch (error) {
      if (!(error instanceof ContextModuleNotFoundError)) {
        logger.warn('business harness context assembly failed', {
          runId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
      return { untrustedSpans: [], citableSources: [] }
    }
  }

  private async enforceInputGuardrail(
    agentId: string,
    runId: string,
    ctx: AgentRunCtx,
    untrustedSpans: UntrustedSpan[],
    failOnce: (message: string) => Promise<void>,
  ): Promise<void> {
    const verdict = await new GuardrailService(this.container).checkInput({
      capability: agentId,
      untrustedSpans,
    })
    if (verdict.checks.length === 0) return
    await persistVerdict(
      { em: (this.container.resolve('em') as EntityManager).fork() },
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId, agentRunId: runId },
      { verdict, capability: agentId, phase: 'input', proposalId: null },
    )
    if (verdict.result !== 'block' || !verdict.blockedReason) return
    const detail = '[internal] pre-call guardrail block (prompt_injection)'
    await failOnce(detail)
    throw new AgentGuardrailBlockedError(agentId, detail, {
      phase: verdict.blockedReason.phase,
      kind: verdict.blockedReason.kind,
      guardrailSetVersion: GUARDRAIL_SET_VERSION,
    })
  }

  private async enforceOutputGuardrail(input: {
    entry: AgentRegistryEntry
    agentId: string
    runId: string
    ctx: AgentRunCtx
    rawOutput: unknown
    allowedTools: string[]
    citableSources: CitableSource[]
    failOnce: (message: string) => Promise<void>
  }): Promise<{ parsed: unknown; guardResults: GuardResults }> {
    let grounding:
      | { set: GuardrailSetBody; groundingSetVersion: string; citableSources: CitableSource[] }
      | undefined
    try {
      const set = await resolveCurrentGroundingSet(
        (this.container.resolve('em') as EntityManager).fork(),
        { tenantId: input.ctx.tenantId, organizationId: input.ctx.organizationId },
        input.agentId,
      )
      if (set) {
        grounding = {
          set: set.body as GuardrailSetBody,
          groundingSetVersion: set.version,
          citableSources: input.citableSources,
        }
      }
    } catch (error) {
      logger.warn('business harness grounding set resolution failed', {
        runId: input.runId,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    const verdict = await new GuardrailService(this.container).checkOutput({
      capability: input.agentId,
      schema: input.entry.schema,
      output: input.rawOutput,
      allowedTools: input.allowedTools,
      grounding,
    })
    const scope = {
      tenantId: input.ctx.tenantId,
      organizationId: input.ctx.organizationId,
      agentRunId: input.runId,
    }
    const parsed = input.entry.schema.safeParse(input.rawOutput)
    if (!parsed.success || verdict.result === 'block') {
      await persistVerdict(
        { em: (this.container.resolve('em') as EntityManager).fork() },
        scope,
        { verdict, capability: input.agentId, phase: 'output', proposalId: null },
      )
      const detail = parsed.success ? 'guardrail block' : parsed.error.message
      await input.failOnce(detail)
      if (verdict.blockedReason) {
        throw new AgentGuardrailBlockedError(input.agentId, detail, {
          phase: verdict.blockedReason.phase,
          kind: verdict.blockedReason.kind,
          guardrailSetVersion: GUARDRAIL_SET_VERSION,
        })
      }
      throw new AgentOutputInvalidError(input.agentId, detail)
    }
    const guardResults = await persistVerdict(
      { em: (this.container.resolve('em') as EntityManager).fork() },
      scope,
      { verdict, capability: input.agentId, phase: 'output', proposalId: null },
    )
    return { parsed: parsed.data, guardResults }
  }

  private async consumeEvent(
    event: BusinessHarnessRunEvent,
    state: {
      runId: string
      agentId: string
      ctx: AgentRunCtx
      modelId: string
      stepRecords: NativeStepRecord[]
      pendingToolCalls: Map<string, { startedAtMs: number; call: NativeStepToolCall }>
    },
  ): Promise<void> {
    if (event.runId !== state.runId) return
    if (event.type === 'tool.started') {
      state.pendingToolCalls.set(toolEventKey(event), {
        startedAtMs: Date.now(),
        call: {
          toolName: event.capabilityToolName,
          args: {},
          result: undefined,
          durationMs: 0,
        },
      })
      await this.emitProgress(state, event.capabilityToolName, event.call, 'started', 'ok')
      return
    }
    if (event.type === 'tool.finished') {
      const key = toolEventKey(event)
      const pending = state.pendingToolCalls.get(key) ?? {
        startedAtMs: Date.now() - event.durationMs,
        call: { toolName: event.capabilityToolName, args: {}, result: undefined, durationMs: 0 },
      }
      pending.call.durationMs = event.durationMs
      if (event.isError) pending.call.error = { code: 'tool_failed', message: 'Capability call failed' }
      state.pendingToolCalls.set(key, pending)
      await this.emitProgress(
        state,
        event.capabilityToolName,
        event.call,
        'finished',
        event.isError ? 'error' : 'ok',
      )
      return
    }
    if (event.type === 'step.finished') {
      state.stepRecords.push({
        modelId: state.modelId,
        finishReason: event.finishReason,
        usage: {
          inputTokens: event.usage.inputTokens ?? 0,
          outputTokens: event.usage.outputTokens ?? 0,
        },
        toolCalls: [...state.pendingToolCalls.values()].map((item) => item.call),
        endedAtMs: Date.now(),
      })
      state.pendingToolCalls.clear()
      await this.emitWorkflowAction(state, 'step_finish', undefined, event.step, event.finishReason)
    }
  }

  private async emitProgress(
    state: { runId: string; agentId: string; ctx: AgentRunCtx },
    tool: string,
    sequence: number,
    phase: 'started' | 'finished',
    status: 'ok' | 'error',
  ): Promise<void> {
    try {
      await emitAgentOrchestratorEvent('agent_orchestrator.run.progress', {
        id: state.runId,
        runId: state.runId,
        agentId: state.agentId,
        tenantId: state.ctx.tenantId,
        organizationId: state.ctx.organizationId,
        sequence,
        callId: `${state.runId}:${sequence}`,
        tool,
        phase,
        status,
        label: tool,
      })
    } catch {
      // Progress telemetry is best-effort.
    }
    await this.emitWorkflowAction(state, 'tool_call', tool, sequence, null)
  }

  private async emitWorkflowAction(
    state: { runId: string; agentId: string; ctx: AgentRunCtx },
    kind: 'tool_call' | 'step_finish',
    name: string | undefined,
    stepIndex: number,
    finishReason: string | null,
  ): Promise<void> {
    if (!state.ctx.processId) return
    try {
      const eventBus = this.container.resolve('eventBus') as {
        emitEvent(event: string, payload: Record<string, unknown>): Promise<void>
      }
      await eventBus.emitEvent('workflows.agent.action', {
        id: state.ctx.processId,
        instanceId: state.ctx.processId,
        stepId: state.ctx.stepId ?? null,
        tenantId: state.ctx.tenantId,
        organizationId: state.ctx.organizationId,
        agentId: state.agentId,
        kind,
        ...(name ? { name } : {}),
        stepIndex,
        toolCallCount: kind === 'tool_call' ? 1 : 0,
        finishReason,
      })
    } catch {
      // Workflow telemetry is best-effort.
    }
  }

  private async getUserRoleIds(
    em: EntityManager,
    userId: string,
    tenantId: string,
  ): Promise<string[]> {
    if (!tenantId || !userId) return []
    try {
      const links = await findWithDecryption(
        em,
        UserRole,
        { user: userId, role: { tenantId } } as Record<string, unknown>,
        { populate: ['role'] },
        { tenantId, organizationId: null },
      )
      return (Array.isArray(links) ? links : [])
        .map((link) => (link.role as { id?: string } | undefined)?.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    } catch (error) {
      logger.warn('failed to resolve roles for business harness run', {
        error: error instanceof Error ? error.message : String(error),
      })
      return []
    }
  }
}

function resolveLoopSettings(
  entry: AgentRegistryEntry,
  ctx: AgentRunCtx,
  override: { disabled: boolean; maxSteps?: number; maxToolCalls?: number; maxWallClockMs?: number },
): BusinessHarnessLoopSettings {
  const timeoutMs = clamp(
    ctx.runTimeoutMs ?? override.maxWallClockMs ?? resolveTimeoutFromContext(ctx),
    1,
    MAX_TIMEOUT_MS,
  )
  const maxSteps = override.disabled
    ? 1
    : clamp(override.maxSteps ?? entry.loop?.maxSteps ?? DEFAULT_MAX_STEPS, 1, MAX_STEPS)
  const maxToolCalls = clamp(override.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS, 0, MAX_TOOL_CALLS)
  return { timeoutMs, maxSteps, maxToolCalls }
}

function resolveTimeoutFromContext(_ctx: AgentRunCtx): number {
  const parsed = Number.parseInt(process.env.OM_BUSINESS_HARNESS_RUN_TIMEOUT_MS ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, MAX_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.floor(value)))
}

function assertResultIdentity(
  result: BusinessHarnessRunResult,
  bundle: ReturnType<typeof compileBusinessHarnessBundle>['bundle'],
): void {
  const expected = bundle.agent
  if (
    result.protocolVersion !== '1' ||
    result.status !== 'completed' ||
    result.identity.runId !== bundle.runId ||
    result.identity.agentId !== expected.id ||
    result.identity.agentVersion !== expected.version ||
    result.identity.agentDigest !== expected.digest ||
    result.identity.runtimeProfile !== expected.runtimeProfile ||
    result.identity.model.bindingId !== expected.model.bindingId ||
    result.identity.model.bindingRevision !== expected.model.bindingRevision ||
    result.identity.model.driver !== expected.model.driver ||
    result.identity.model.modelId !== expected.model.modelId
  ) {
    throw new Error('[internal] Business harness returned a mismatched run identity')
  }
}

function toolEventKey(event: { connectorId: string; capabilityToolName: string; call: number }): string {
  return `${event.connectorId}:${event.capabilityToolName}:${event.call}`
}

function flushPendingToolCalls(
  steps: NativeStepRecord[],
  pending: Map<string, { startedAtMs: number; call: NativeStepToolCall }>,
  modelId: string | null,
): void {
  if (pending.size === 0) return
  steps.push({
    modelId: modelId ?? 'unknown',
    finishReason: 'unknown',
    usage: { inputTokens: 0, outputTokens: 0 },
    toolCalls: [...pending.values()].map((item) => item.call),
    endedAtMs: Date.now(),
  })
  pending.clear()
}

function sumUsage(
  steps: NativeStepRecord[],
  key: 'inputTokens' | 'outputTokens',
): number | undefined {
  if (steps.length === 0) return undefined
  return steps.reduce((total, step) => total + step.usage[key], 0)
}

function isHarnessTimeout(error: unknown): boolean {
  return Boolean(
    (error && typeof error === 'object' && 'code' in error && error.code === 'RUN_TIMEOUT') ||
      (error instanceof DOMException && error.name === 'TimeoutError'),
  )
}
