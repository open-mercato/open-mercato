// Native-runner wiring tests (lightweight-agent-runtime Phase 1+2): the run row
// is stamped `(runtime='native', externalRunId=runId)`, per-step records reach
// the post-run trace capture on success AND failure, a capture failure never
// fails the run, and the model call runs under the provider budget.

import { captureLogs } from './support/captureLogs'

// Pulling in the agent runtime drags the ai_assistant tool registry with it,
// which parses the generated OpenAPI document and registers the Code Mode tools
// on first use. That one-off cost lands inside whichever test runs first and
// comfortably clears jest's 5 s default on a loaded CI runner — the suite takes
// ~2 s locally and ~40 s there. This is the harness's budget, not the
// behaviour's: every assertion below is unchanged.
jest.setTimeout(60_000)

const runAiAgentObjectMock = jest.fn<Promise<unknown>, [Record<string, unknown>]>()
jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-runtime', () => ({
  runAiAgentObject: (args: Record<string, unknown>) => runAiAgentObjectMock(args),
}))
jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/model-factory', () => ({
  createModelFactory: () => ({
    resolveModel: () => ({ providerId: 'test-provider', modelId: 'test-model', model: {}, source: 'env_default' }),
  }),
}))

const createRunMock = jest.fn<Promise<string>, unknown[]>()
const completeRunMock = jest.fn<Promise<void>, unknown[]>()
const failRunMock = jest.fn<Promise<void>, unknown[]>()
const createProposalMock = jest.fn<Promise<void>, unknown[]>()
jest.mock('../lib/runtime/persistence', () => ({
  buildCommandContext: () => ({}),
  resolveCallerAcl: async () => ({ features: [], isSuperAdmin: false }),
  createRun: (...args: unknown[]) => createRunMock(...args),
  completeRun: (...args: unknown[]) => completeRunMock(...args),
  failRun: (...args: unknown[]) => failRunMock(...args),
  createProposal: (...args: unknown[]) => createProposalMock(...args),
  shapeResult: (kind: 'research' | 'proposal', data: unknown) => {
    const record = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
    return kind === 'research'
      ? { kind: 'research', data: 'data' in record ? record.data : data }
      : { kind: 'proposal', proposal: record.proposal ?? data }
  },
}))

const checkOutputMock = jest.fn<Promise<unknown>, [Record<string, unknown>]>()
const persistVerdictMock = jest.fn<Promise<unknown>, unknown[]>()
jest.mock('../lib/guardrails/guardrailService', () => ({
  GUARDRAIL_SET_VERSION: 'test-version',
  persistVerdict: (...args: unknown[]) => persistVerdictMock(...args),
  GuardrailService: class {
    async checkInput() {
      return { result: 'pass', checks: [] }
    }
    async checkOutput(args: Record<string, unknown>) {
      return checkOutputMock(args)
    }
  },
}))
jest.mock('../lib/guardrails/syncGroundingSets', () => ({
  resolveCurrentGroundingSet: jest.fn(async () => null),
}))

const syncIntegritySetsMock = jest.fn<Promise<number>, unknown[]>()
jest.mock('../lib/guardrails/integrity/integritySets', () => {
  const actual = jest.requireActual('../lib/guardrails/integrity/integritySets')
  return { ...actual, syncIntegritySets: (...args: unknown[]) => syncIntegritySetsMock(...args) }
})

const captureNativeRunTraceMock = jest.fn<Promise<void>, unknown[]>()
jest.mock('../lib/runtime/nativeTraceCapture', () => {
  const actual = jest.requireActual('../lib/runtime/nativeTraceCapture')
  return {
    ...actual,
    captureNativeRunTrace: (...args: unknown[]) => captureNativeRunTraceMock(...args),
  }
})

const putArtifactMock = jest.fn<Promise<string | null>, unknown[]>()
jest.mock('../lib/trace/artifactStore', () => {
  const actual = jest.requireActual('../lib/trace/artifactStore')
  return { ...actual, putArtifact: (...args: unknown[]) => putArtifactMock(...args) }
})

import { z } from 'zod'
import { ARTIFACT_REFS } from '../lib/trace/artifactStore'
import { integrityRuleSchema } from '../data/validators'
import { resolveIntegritySet } from '../lib/guardrails/integrity/integritySets'
import { AgentGuardrailBlockedError } from '../lib/runtime/errors'
import { AgentRuntimeService } from '../lib/runtime/agentRuntime'
import { registerFileAgent, getAgentEntry, type AgentRegistryEntry } from '../lib/sdk/defineAgent'
import { resetAgentAdmissionForTests } from '../lib/runtime/admission'
import { resetProviderBudgetForTests } from '../lib/runtime/providerBudget'
import { buildNativeTracePayload, type NativeTraceInput } from '../lib/runtime/nativeTraceCapture'
import { RUN_MANIFEST_SPAN_NAME, computeManifestSha256 } from '../lib/trace/runManifest'
import { reportKnowledgeVersion } from '@open-mercato/shared/lib/ai/run-observation'

function registerNativeAgent(id: string): AgentRegistryEntry {
  const existing = getAgentEntry(id)
  if (existing) return existing
  const entry: AgentRegistryEntry = {
    id,
    moduleId: 'agent_orchestrator',
    resultKind: 'research',
    schema: z.object({ kind: z.literal('research'), data: z.unknown() }),
    tools: [],
    skills: [],
    subAgents: [],
    label: 'Native wiring test agent',
    description: 'Researcher agent for native-runner wiring tests.',
    instructions: 'inform',
    runtime: 'native',
  }
  registerFileAgent(entry)
  return entry
}

function makeService(): AgentRuntimeService {
  const container = {
    resolve(name: string) {
      if (name === 'em') return { fork: () => ({}) }
      throw new Error(`[internal] unexpected resolve("${name}")`)
    },
  }
  return new AgentRuntimeService({ container: container as never, commandBus: {} as never })
}

const VALID_MODEL_OUTPUT = { mode: 'generate', object: { kind: 'research', data: { ok: true } }, usage: { inputTokens: 9, outputTokens: 3 } }
const runCtx = { tenantId: 'tenant-1', organizationId: 'org-1', userId: 'user-1' }

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

let runSeq = 0

beforeEach(() => {
  runAiAgentObjectMock.mockReset()
  createRunMock.mockReset().mockImplementation(async () => `run-${++runSeq}`)
  completeRunMock.mockReset().mockResolvedValue(undefined)
  failRunMock.mockReset().mockResolvedValue(undefined)
  createProposalMock.mockReset().mockResolvedValue(undefined)
  captureNativeRunTraceMock.mockReset().mockResolvedValue(undefined)
  checkOutputMock.mockReset().mockResolvedValue({ result: 'pass', checks: [] })
  persistVerdictMock.mockReset().mockResolvedValue([])
  putArtifactMock.mockReset().mockResolvedValue(null)
  syncIntegritySetsMock.mockReset().mockResolvedValue(0)
  delete process.env.OM_AGENT_TRACE_CAPTURE
  delete process.env.OM_AGENT_INTEGRITY
})

afterEach(() => {
  resetAgentAdmissionForTests()
  resetProviderBudgetForTests()
  delete process.env.OM_AGENT_TRACE_CAPTURE
  delete process.env.OM_AGENT_INTEGRITY
})

describe('native run stamping', () => {
  it('creates the run with runtime=native and self-stamped externalRunId', async () => {
    registerNativeAgent('native.stamp_agent')
    runAiAgentObjectMock.mockResolvedValue(VALID_MODEL_OUTPUT)

    const service = makeService()
    await service.run('native.stamp_agent', { x: 1 }, runCtx)

    expect(createRunMock).toHaveBeenCalledTimes(1)
    const createInput = createRunMock.mock.calls[0][2] as Record<string, unknown>
    expect(createInput.runtime).toBe('native')
    expect(createInput.stampExternalRunIdFromId).toBe(true)
  })

  it('invokes ctx.onRunPersisted with the created run id, and a throwing hook never fails the run', async () => {
    registerNativeAgent('native.hook_agent')
    runAiAgentObjectMock.mockResolvedValue(VALID_MODEL_OUTPUT)

    const service = makeService()
    const observed: string[] = []
    const result = await service.run('native.hook_agent', {}, {
      ...runCtx,
      onRunPersisted: (persistedRunId: string) => {
        observed.push(persistedRunId)
      },
    })
    expect(result.kind).toBe('research')
    expect(observed).toHaveLength(1)
    expect(observed[0]).toMatch(/^run-\d+$/)

    const logs = captureLogs()
    try {
      const result2 = await service.run('native.hook_agent', {}, {
        ...runCtx,
        onRunPersisted: () => {
          throw new Error('[internal] hook boom')
        },
      })
      expect(result2.kind).toBe('research')
      expect(logs.at('warn').map((record) => record.message)).toContain('onRunPersisted hook failed')
    } finally {
      logs.restore()
    }
  })

  it('dispatches a legacy in-process entry to the same native runner', async () => {
    const entry: AgentRegistryEntry = {
      id: 'native.legacy_alias_agent',
      moduleId: 'agent_orchestrator',
      resultKind: 'research',
      schema: z.object({ kind: z.literal('research'), data: z.unknown() }),
      tools: [],
      skills: [],
      subAgents: [],
      label: 'Legacy alias agent',
      description: 'Registered with the legacy in-process runtime value.',
      instructions: 'inform',
      runtime: 'in-process',
    }
    if (!getAgentEntry(entry.id)) registerFileAgent(entry)
    runAiAgentObjectMock.mockResolvedValue(VALID_MODEL_OUTPUT)

    const service = makeService()
    const result = await service.run('native.legacy_alias_agent', {}, runCtx)
    expect(result.kind).toBe('research')
    const createInput = createRunMock.mock.calls[0][2] as Record<string, unknown>
    expect(createInput.runtime).toBe('native')
  })
})

describe('post-run trace capture', () => {
  it('captures per-step records after a successful run', async () => {
    registerNativeAgent('native.capture_agent')
    runAiAgentObjectMock.mockImplementation(async (args) => {
      const loop = args.loop as { onStepFinish?: (event: unknown) => Promise<void> } | undefined
      await loop?.onStepFinish?.({
        toolCalls: [{ toolName: 'customers.get_deal', args: { id: 'd1' }, result: { ok: true } }],
        finishReason: 'tool-calls',
        usage: { inputTokens: 5, outputTokens: 2 },
        response: { modelId: 'test-model' },
      })
      await loop?.onStepFinish?.({
        toolCalls: [],
        finishReason: 'stop',
        usage: { inputTokens: 4, outputTokens: 6 },
        response: { modelId: 'test-model' },
      })
      return VALID_MODEL_OUTPUT
    })

    const service = makeService()
    await service.run('native.capture_agent', { x: 1 }, runCtx)
    await flushMicrotasks()

    expect(captureNativeRunTraceMock).toHaveBeenCalledTimes(1)
    const traceInput = captureNativeRunTraceMock.mock.calls[0][2] as NativeTraceInput
    expect(traceInput.agentId).toBe('native.capture_agent')
    expect(traceInput.steps).toHaveLength(2)
    expect(traceInput.steps[0].modelId).toBe('test-model')
    expect(traceInput.steps[0].toolCalls[0].toolName).toBe('customers.get_deal')
    const scope = captureNativeRunTraceMock.mock.calls[0][1] as Record<string, string>
    expect(scope).toEqual({ tenantId: 'tenant-1', organizationId: 'org-1' })
  })

  it('records AI SDK 7 tool inputs, outputs and tool errors on the captured steps', async () => {
    registerNativeAgent('native.sdk7_capture_agent')
    runAiAgentObjectMock.mockImplementation(async (args) => {
      const loop = args.loop as { onStepFinish?: (event: unknown) => Promise<void> } | undefined
      await loop?.onStepFinish?.({
        toolCalls: [
          { toolCallId: 'call-1', toolName: 'customers.get_deal', input: { id: 'd1' } },
          { toolCallId: 'call-2', toolName: 'customers.list_people', input: { query: 'acme' } },
        ],
        toolResults: [{ toolCallId: 'call-1', toolName: 'customers.get_deal', output: { title: 'Big deal' } }],
        content: [
          { type: 'tool-error', toolCallId: 'call-2', toolName: 'customers.list_people', error: new Error('search down') },
        ],
        finishReason: 'tool-calls',
        usage: { inputTokens: 5, outputTokens: 2 },
        response: { modelId: 'test-model' },
      })
      return VALID_MODEL_OUTPUT
    })

    const service = makeService()
    await service.run('native.sdk7_capture_agent', { x: 1 }, runCtx)
    await flushMicrotasks()

    const traceInput = captureNativeRunTraceMock.mock.calls[0][2] as NativeTraceInput
    expect(traceInput.steps[0].toolCalls).toEqual([
      { toolName: 'customers.get_deal', args: { id: 'd1' }, result: { title: 'Big deal' }, durationMs: 0 },
      {
        toolName: 'customers.list_people',
        args: { query: 'acme' },
        result: undefined,
        error: { code: 'Error', message: 'search down' },
        durationMs: 0,
      },
    ])
  })

  it('captures the partial trace when the model call fails', async () => {
    registerNativeAgent('native.failed_capture_agent')
    runAiAgentObjectMock.mockImplementation(async (args) => {
      const loop = args.loop as { onStepFinish?: (event: unknown) => Promise<void> } | undefined
      await loop?.onStepFinish?.({
        toolCalls: [],
        finishReason: 'stop',
        usage: { inputTokens: 1, outputTokens: 1 },
        response: { modelId: 'test-model' },
      })
      throw new Error('[internal] model exploded')
    })

    const service = makeService()
    await expect(service.run('native.failed_capture_agent', {}, runCtx)).rejects.toThrow('model exploded')
    await flushMicrotasks()

    expect(failRunMock).toHaveBeenCalledTimes(1)
    expect(captureNativeRunTraceMock).toHaveBeenCalledTimes(1)
    const traceInput = captureNativeRunTraceMock.mock.calls[0][2] as NativeTraceInput
    expect(traceInput.steps).toHaveLength(1)
  })

  it('a rejected capture never fails the run', async () => {
    registerNativeAgent('native.capture_failure_agent')
    runAiAgentObjectMock.mockResolvedValue(VALID_MODEL_OUTPUT)
    captureNativeRunTraceMock.mockRejectedValue(new Error('[internal] trace store down'))

    const service = makeService()
    const result = await service.run('native.capture_failure_agent', {}, runCtx)
    expect(result.kind).toBe('research')
    await flushMicrotasks()
    expect(completeRunMock).toHaveBeenCalledTimes(1)
    expect(failRunMock).not.toHaveBeenCalled()
  })

  it('surfaces the original settle error when failRun and the trace capture also throw', async () => {
    registerNativeAgent('native.settle_failure_agent')
    runAiAgentObjectMock.mockResolvedValue(VALID_MODEL_OUTPUT)
    completeRunMock.mockRejectedValue(new Error('[internal] complete run exploded'))
    failRunMock.mockRejectedValue(new Error('[internal] fail run exploded'))
    captureNativeRunTraceMock.mockRejectedValue(new Error('[internal] trace store down'))

    const service = makeService()
    await expect(service.run('native.settle_failure_agent', {}, runCtx)).rejects.toThrow(
      'complete run exploded',
    )
    expect(failRunMock).toHaveBeenCalledTimes(1)
  })

  it('the trace is persisted BEFORE run() resolves, so the disposition cannot race it', async () => {
    registerNativeAgent('native.capture_ordering_agent')
    runAiAgentObjectMock.mockResolvedValue(VALID_MODEL_OUTPUT)

    let releaseCapture = (): void => {}
    captureNativeRunTraceMock.mockReturnValue(
      new Promise<void>((resolve) => {
        releaseCapture = resolve
      }),
    )

    const service = makeService()
    let settled = false
    const pending = service.run('native.capture_ordering_agent', {}, runCtx).then((result) => {
      settled = true
      return result
    })

    await flushMicrotasks()
    expect(captureNativeRunTraceMock).toHaveBeenCalledTimes(1)
    // The whole point of awaiting it: `dispositionService` counts this run's
    // spans the instant the runner returns, and reads zero as "unauditable, hold
    // for a human". A capture still in flight at that moment made auto-approval
    // depend on I/O timing rather than on policy.
    expect(settled).toBe(false)

    releaseCapture()
    await pending
    expect(settled).toBe(true)
  })

  it('hands the prompt metadata and the bound run observation to the manifest', async () => {
    registerNativeAgent('native.manifest_agent')
    runAiAgentObjectMock.mockImplementation(async (args) => {
      const observe = args.observe as { onPromptResolved?: (event: unknown) => void } | undefined
      observe?.onPromptResolved?.({
        agentId: 'native.manifest_agent',
        systemPrompt: 'system prompt body',
        promptOverride: { id: 'override-7', version: 2 },
        pageContextHydrated: false,
        attachmentCount: 0,
        provider: 'test-provider',
        modelId: 'test-model',
      })
      await Promise.resolve()
      reportKnowledgeVersion('rules.rule_set', '2026-10-20.3')
      return VALID_MODEL_OUTPUT
    })

    await makeService().run('native.manifest_agent', {}, runCtx)

    const traceInput = captureNativeRunTraceMock.mock.calls[0][2] as NativeTraceInput
    expect(traceInput.manifest).toMatchObject({
      runtime: 'native',
      agentId: 'native.manifest_agent',
      agentSource: 'code',
      ctx: { userId: 'user-1' },
      promptOverride: { id: 'override-7', version: 2 },
      systemPromptSha256: computeManifestSha256('system prompt body'),
      modelResolved: 'test-model',
      provider: 'test-provider',
      observation: { knowledge: { 'rules.rule_set': { version: '2026-10-20.3' } } },
    })
    const payload = buildNativeTracePayload(traceInput)
    const manifestSpans = (payload.spans ?? []).filter((span) => span.name === RUN_MANIFEST_SPAN_NAME)
    expect(manifestSpans).toHaveLength(1)
    expect((manifestSpans[0].attributes as Record<string, unknown>)['om.knowledge']).toEqual({
      'rules.rule_set': '2026-10-20.3',
    })
  })

  it('records the invoker, entry point and correlation id from the run context in the manifest', async () => {
    registerNativeAgent('native.manifest_identity_agent')
    runAiAgentObjectMock.mockResolvedValue(VALID_MODEL_OUTPUT)

    await makeService().run('native.manifest_identity_agent', {}, {
      ...runCtx,
      invoker: { kind: 'workflow', actingUserId: 'user-1' },
      entryPoint: 'workflow',
      correlationId: 'corr-1',
    })

    const traceInput = captureNativeRunTraceMock.mock.calls[0][2] as NativeTraceInput
    const payload = buildNativeTracePayload(traceInput)
    const manifest = (payload.spans ?? []).find((span) => span.name === RUN_MANIFEST_SPAN_NAME)
    const attributes = manifest?.attributes as Record<string, unknown>
    expect(attributes['om.invoker']).toEqual({ kind: 'workflow', userId: 'user-1', apiKeyId: null, ownerUserId: null })
    expect(attributes['om.entry_point']).toBe('workflow')
    expect(attributes['om.correlation_id']).toBe('corr-1')
  })

  it('OM_AGENT_TRACE_CAPTURE=off skips capture and the step hook', async () => {
    process.env.OM_AGENT_TRACE_CAPTURE = 'off'
    registerNativeAgent('native.capture_off_agent')
    runAiAgentObjectMock.mockResolvedValue(VALID_MODEL_OUTPUT)

    const service = makeService()
    await service.run('native.capture_off_agent', {}, runCtx)
    await flushMicrotasks()

    expect(captureNativeRunTraceMock).not.toHaveBeenCalled()
    const callArgs = runAiAgentObjectMock.mock.calls[0][0]
    expect(callArgs.loop).toBeUndefined()
    expect(callArgs.observe).toBeUndefined()
  })
})

describe('run record ownership', () => {
  it('disables the OSS run recorder for native runs', async () => {
    registerNativeAgent('native.no_oss_record_agent')
    runAiAgentObjectMock.mockResolvedValue(VALID_MODEL_OUTPUT)

    const service = makeService()
    await service.run('native.no_oss_record_agent', {}, runCtx)

    expect(runAiAgentObjectMock.mock.calls[0][0].trace).toEqual({ persist: false })
  })
})

describe('provider budget wiring', () => {
  it('a saturated provider budget queues the second run until the first releases', async () => {
    process.env.OM_AGENT_PROVIDER_MAX_CONCURRENT = '1'
    try {
      registerNativeAgent('native.budget_agent')
      let releaseFirst: (() => void) | null = null
      let calls = 0
      runAiAgentObjectMock.mockImplementation(() => {
        calls += 1
        if (calls === 1) {
          return new Promise((resolve) => {
            releaseFirst = () => resolve(VALID_MODEL_OUTPUT)
          })
        }
        return Promise.resolve(VALID_MODEL_OUTPUT)
      })

      const service = makeService()
      const first = service.run('native.budget_agent', {}, runCtx)
      for (let i = 0; i < 50 && releaseFirst === null; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1))
      }
      expect(releaseFirst).not.toBeNull()

      const second = service.run('native.budget_agent', {}, runCtx)
      await new Promise((resolve) => setTimeout(resolve, 20))
      // The second model call is held at the provider gate while the first holds the slot.
      expect(calls).toBe(1)

      releaseFirst!()
      await first
      await second
      expect(calls).toBe(2)
    } finally {
      delete process.env.OM_AGENT_PROVIDER_MAX_CONCURRENT
    }
  })
})

describe('confidence + usage/cost stamping (data-honesty §3.2)', () => {
  it('stamps confidence from the proposal and computed cost on a proposal run', async () => {
    const entry: AgentRegistryEntry = {
      id: 'native.cost_stamp_agent',
      moduleId: 'agent_orchestrator',
      resultKind: 'proposal',
      schema: z.object({
        kind: z.literal('proposal'),
        proposal: z.object({ confidence: z.number().optional() }).passthrough(),
      }),
      tools: [],
      skills: [],
      subAgents: [],
      label: 'Cost stamp agent',
      description: 'Proposal agent for stamping tests.',
      instructions: 'propose',
      runtime: 'native',
      defaultModel: 'gpt-5-mini',
    }
    if (!getAgentEntry(entry.id)) registerFileAgent(entry)
    runAiAgentObjectMock.mockImplementation(async (args) => {
      const loop = args.loop as { onStepFinish?: (event: unknown) => Promise<void> } | undefined
      await loop?.onStepFinish?.({
        toolCalls: [],
        finishReason: 'tool-calls',
        usage: { inputTokens: 1_000_000, outputTokens: 0 },
        response: { modelId: 'gpt-5-mini' },
      })
      await loop?.onStepFinish?.({
        toolCalls: [],
        finishReason: 'stop',
        usage: { inputTokens: 0, outputTokens: 1_000_000 },
        response: { modelId: 'gpt-5-mini' },
      })
      return {
        mode: 'generate',
        object: { kind: 'proposal', proposal: { confidence: 0.83 } },
        usage: { inputTokens: 1, outputTokens: 1 },
      }
    })

    const service = makeService()
    await service.run('native.cost_stamp_agent', {}, runCtx)

    expect(completeRunMock).toHaveBeenCalledTimes(1)
    const input = completeRunMock.mock.calls[0][2] as Record<string, unknown>
    expect(input.confidence).toBe(0.83)
    // Steps win over fallback usage: 1M in + 1M out.
    expect(input.inputTokens).toBe(1_000_000)
    expect(input.outputTokens).toBe(1_000_000)
    // gpt-5-mini defaults: 0.25 + 2 USD per 1M → 2.25 USD → 225 cents.
    expect(input.costMinor).toBe(225)
    expect(input.currency).toBe('USD')
  })

  it('researcher run: null confidence, fallback usage, no cost without a priced model', async () => {
    registerNativeAgent('native.researcher_stamp_agent')
    runAiAgentObjectMock.mockResolvedValue(VALID_MODEL_OUTPUT)

    const service = makeService()
    await service.run('native.researcher_stamp_agent', {}, runCtx)

    const input = completeRunMock.mock.calls[0][2] as Record<string, unknown>
    expect(input.confidence).toBeNull()
    // Generate-mode fallback usage from VALID_MODEL_OUTPUT.
    expect(input.inputTokens).toBe(9)
    expect(input.outputTokens).toBe(3)
    // No declared model and no step model id → unknown → cost stays absent.
    expect(input.costMinor).toBeUndefined()
  })

  it('a failed model call still stamps the tokens consumed so far', async () => {
    registerNativeAgent('native.failed_stamp_agent')
    runAiAgentObjectMock.mockImplementation(async (args) => {
      const loop = args.loop as { onStepFinish?: (event: unknown) => Promise<void> } | undefined
      await loop?.onStepFinish?.({
        toolCalls: [],
        finishReason: 'stop',
        usage: { inputTokens: 700, outputTokens: 50 },
        response: { modelId: 'test-model' },
      })
      throw new Error('[internal] model exploded')
    })

    const service = makeService()
    await expect(service.run('native.failed_stamp_agent', {}, runCtx)).rejects.toThrow('model exploded')

    expect(failRunMock).toHaveBeenCalledTimes(1)
    const input = failRunMock.mock.calls[0][2] as Record<string, unknown>
    expect(input.inputTokens).toBe(700)
    expect(input.outputTokens).toBe(50)
  })
})

describe('output pipeline wiring', () => {
  const CONTENT = 'The supplier shall deliver within 30 days. Late delivery incurs a penalty of 2% per week.'
  const integritySchema = z.object({
    kind: z.literal('proposal'),
    proposal: z.object({ evidence: z.array(z.object({ quote: z.string() })) }),
  })

  function registerIntegrityAgent(id: string, onViolation: 'drop' | 'block'): AgentRegistryEntry {
    const existing = getAgentEntry(id)
    if (existing) return existing
    const entry: AgentRegistryEntry = {
      id,
      moduleId: 'agent_orchestrator',
      resultKind: 'proposal',
      schema: integritySchema,
      tools: ['customers.get_deal'],
      skills: [],
      subAgents: [],
      label: 'Integrity wiring test agent',
      description: 'Proposal agent for output pipeline wiring tests.',
      instructions: 'propose',
      runtime: 'native',
      integrity: [
        integrityRuleSchema.parse({
          id: 'quotes',
          kind: 'evidence_quote',
          items: 'proposal.evidence[*]',
          quote: 'quote',
          source: { input: 'content' },
          onViolation,
        }),
      ],
    }
    registerFileAgent(entry)
    return entry
  }

  const RAW_PROPOSAL = {
    kind: 'proposal',
    proposal: { evidence: [{ quote: 'deliver within 30 days' }, { quote: 'free shipping forever' }] },
  }

  function mockModelWithToolCall(): void {
    runAiAgentObjectMock.mockImplementation(async (args) => {
      const loop = args.loop as { onStepFinish?: (event: unknown) => Promise<void> } | undefined
      await loop?.onStepFinish?.({
        toolCalls: [{ toolCallId: 'call-1', toolName: 'customers__get_deal', input: { id: 'd1' } }],
        toolResults: [{ toolCallId: 'call-1', toolName: 'customers__get_deal', output: { title: 'Big deal' } }],
        finishReason: 'tool-calls',
        usage: { inputTokens: 5, outputTokens: 2 },
        response: { modelId: 'test-model' },
      })
      return { mode: 'generate', object: RAW_PROPOSAL, usage: { inputTokens: 5, outputTokens: 2 } }
    })
  }

  it('runs the pipeline and persists, completes and proposes the final output', async () => {
    registerIntegrityAgent('native.integrity_drop_agent', 'drop')
    mockModelWithToolCall()

    const service = makeService()
    const result = await service.run('native.integrity_drop_agent', { content: CONTENT }, runCtx)

    const finalProposal = { evidence: [{ quote: 'deliver within 30 days' }] }
    expect(result).toEqual({ kind: 'proposal', proposal: finalProposal })
    const completeInput = completeRunMock.mock.calls[0][2] as Record<string, unknown>
    expect(completeInput.output).toEqual({ kind: 'proposal', proposal: finalProposal })
    const proposalInput = createProposalMock.mock.calls[0][2] as Record<string, unknown>
    expect(proposalInput.payload).toEqual(finalProposal)
    const persisted = persistVerdictMock.mock.calls[0][2] as { verdict: { result: string; checks: Array<{ kind: string }> } }
    expect(persisted.verdict.result).toBe('warn')
    expect(persisted.verdict.checks.map((check) => check.kind)).toContain('evidence_quote')
  })

  it('collects tool calls for tool_scope with trace capture off, without capturing a trace', async () => {
    process.env.OM_AGENT_TRACE_CAPTURE = 'off'
    registerIntegrityAgent('native.integrity_tools_agent', 'drop')
    mockModelWithToolCall()

    const service = makeService()
    await service.run('native.integrity_tools_agent', { content: CONTENT }, runCtx)

    expect(captureNativeRunTraceMock).not.toHaveBeenCalled()
    expect(checkOutputMock).toHaveBeenCalledTimes(2)
    const finalCall = checkOutputMock.mock.calls[1][0]
    expect(finalCall.attemptedTools).toEqual([{ name: 'customers.get_deal', isMutation: false }])
    expect(finalCall.allowedTools).toEqual(['customers.get_deal'])
    expect(finalCall.output).toEqual({ kind: 'proposal', proposal: { evidence: [{ quote: 'deliver within 30 days' }] } })
  })

  it('fails the run with a guardrail block when an integrity rule blocks', async () => {
    registerIntegrityAgent('native.integrity_block_agent', 'block')
    mockModelWithToolCall()

    const service = makeService()
    const failure = service.run('native.integrity_block_agent', { content: CONTENT }, runCtx)
    await expect(failure).rejects.toBeInstanceOf(AgentGuardrailBlockedError)
    await expect(failure).rejects.toMatchObject({ kind: 'evidence_quote', phase: 'output' })
    expect(failRunMock).toHaveBeenCalledTimes(1)
    expect(completeRunMock).not.toHaveBeenCalled()
    expect(createProposalMock).not.toHaveBeenCalled()
    const persisted = persistVerdictMock.mock.calls[0][2] as { verdict: { result: string } }
    expect(persisted.verdict.result).toBe('block')
  })

  it('reports the blocking integrity check set version on the guardrail block error', async () => {
    const entry = registerIntegrityAgent('native.integrity_block_version_agent', 'block')
    mockModelWithToolCall()

    const failure = makeService().run('native.integrity_block_version_agent', { content: CONTENT }, runCtx)
    const expectedVersion = resolveIntegritySet(entry)?.version
    expect(expectedVersion).toMatch(/^i1-[0-9a-f]{24}$/)
    await expect(failure).rejects.toMatchObject({ kind: 'evidence_quote', guardrailSetVersion: expectedVersion })
  })

  it('fails the run and captures the trace when the output pipeline throws unexpectedly', async () => {
    registerIntegrityAgent('native.integrity_pipeline_throw_agent', 'drop')
    mockModelWithToolCall()
    checkOutputMock.mockRejectedValue(new Error('pipeline exploded'))

    const failure = makeService().run('native.integrity_pipeline_throw_agent', { content: CONTENT }, runCtx)
    await expect(failure).rejects.toThrow('pipeline exploded')
    expect(failRunMock).toHaveBeenCalledTimes(1)
    expect((failRunMock.mock.calls[0][2] as Record<string, unknown>).errorMessage).toBe('pipeline exploded')
    expect(captureNativeRunTraceMock).toHaveBeenCalledTimes(1)
    expect(completeRunMock).not.toHaveBeenCalled()
    expect(createProposalMock).not.toHaveBeenCalled()
  })

  it('pins the agent integrity set version on the integrity check and syncs the set', async () => {
    const entry = registerIntegrityAgent('native.integrity_version_agent', 'drop')
    mockModelWithToolCall()

    await makeService().run('native.integrity_version_agent', { content: CONTENT }, runCtx)

    const expectedVersion = resolveIntegritySet(entry)?.version
    expect(expectedVersion).toMatch(/^i1-[0-9a-f]{24}$/)
    const persisted = persistVerdictMock.mock.calls[0][2] as {
      verdict: { checks: Array<{ kind: string; guardrailSetVersion: string }> }
    }
    const integrityCheck = persisted.verdict.checks.find((check) => check.kind === 'evidence_quote')
    expect(integrityCheck?.guardrailSetVersion).toBe(expectedVersion)
    expect(syncIntegritySetsMock).toHaveBeenCalledTimes(1)
    expect(syncIntegritySetsMock.mock.calls[0][1]).toEqual({ tenantId: 'tenant-1', organizationId: 'org-1' })
    expect(syncIntegritySetsMock.mock.calls[0][2]).toEqual([entry])
  })

  it('a failing integrity set sync never fails the run', async () => {
    registerIntegrityAgent('native.integrity_sync_fail_agent', 'drop')
    mockModelWithToolCall()
    syncIntegritySetsMock.mockRejectedValue(new Error('db down'))

    const logs = captureLogs()
    try {
      const result = await makeService().run('native.integrity_sync_fail_agent', { content: CONTENT }, runCtx)
      expect(result).toEqual({ kind: 'proposal', proposal: { evidence: [{ quote: 'deliver within 30 days' }] } })
      expect(JSON.stringify(logs.at('warn'))).toContain('integrity set sync failed')
    } finally {
      logs.restore()
    }
    expect(completeRunMock).toHaveBeenCalledTimes(1)
  })

  it('OM_AGENT_INTEGRITY=off records the would-be block as a shadow warn and completes with the raw output', async () => {
    process.env.OM_AGENT_INTEGRITY = 'off'
    registerIntegrityAgent('native.integrity_shadow_agent', 'block')
    mockModelWithToolCall()

    const result = await makeService().run('native.integrity_shadow_agent', { content: CONTENT }, runCtx)

    expect(result).toEqual({ kind: 'proposal', proposal: RAW_PROPOSAL.proposal })
    expect(failRunMock).not.toHaveBeenCalled()
    expect(completeRunMock).toHaveBeenCalledTimes(1)
    expect(putArtifactMock).not.toHaveBeenCalled()
    const persisted = persistVerdictMock.mock.calls[0][2] as {
      verdict: { result: string; checks: Array<{ kind: string; result: string; evidence?: Record<string, unknown> }> }
    }
    expect(persisted.verdict.result).toBe('warn')
    const integrityCheck = persisted.verdict.checks.find((check) => check.kind === 'evidence_quote')
    expect(integrityCheck?.result).toBe('warn')
    expect(integrityCheck?.evidence).toMatchObject({ shadow: true, wouldBlock: true })
  })

  it('keeps the single checkOutput call unchanged for agents without integrity', async () => {
    const entry = registerNativeAgent('native.no_integrity_parity_agent')
    runAiAgentObjectMock.mockResolvedValue(VALID_MODEL_OUTPUT)

    const service = makeService()
    await service.run('native.no_integrity_parity_agent', {}, runCtx)

    expect(checkOutputMock).toHaveBeenCalledTimes(1)
    expect(checkOutputMock.mock.calls[0][0]).toEqual({
      capability: 'native.no_integrity_parity_agent',
      schema: entry.schema,
      output: VALID_MODEL_OUTPUT.object,
      allowedTools: [],
      grounding: undefined,
    })
    expect('attemptedTools' in checkOutputMock.mock.calls[0][0]).toBe(false)
  })

  type PersistedCheck = { kind: string; evidence?: Record<string, unknown> }
  function persistedQuoteCheck(): PersistedCheck | undefined {
    const persisted = persistVerdictMock.mock.calls[0][2] as { verdict: { checks: PersistedCheck[] } }
    return persisted.verdict.checks.find((check) => check.kind === 'evidence_quote')
  }
  function capturedManifest(): Record<string, unknown> {
    const traceInput = captureNativeRunTraceMock.mock.calls[0][2] as { manifest: Record<string, unknown> }
    return traceInput.manifest
  }

  it('stores the raw output before completing the run and points the changed check and manifest at it', async () => {
    registerIntegrityAgent('native.integrity_raw_store_agent', 'drop')
    mockModelWithToolCall()
    putArtifactMock.mockResolvedValue('agent-trace-artifacts/raw-1.json')

    await makeService().run('native.integrity_raw_store_agent', { content: CONTENT }, runCtx)

    expect(putArtifactMock).toHaveBeenCalledTimes(1)
    const [, scope, ref, value] = putArtifactMock.mock.calls[0]
    expect(scope).toEqual({ tenantId: 'tenant-1', organizationId: 'org-1' })
    expect(ref).toBe(ARTIFACT_REFS.runRawOutput)
    expect(ref).toEqual({ entityId: 'agent_orchestrator:agent_run', field: 'output' })
    expect(value).toEqual(RAW_PROPOSAL)
    expect(putArtifactMock.mock.invocationCallOrder[0]).toBeLessThan(persistVerdictMock.mock.invocationCallOrder[0])
    expect(putArtifactMock.mock.invocationCallOrder[0]).toBeLessThan(completeRunMock.mock.invocationCallOrder[0])
    expect(persistedQuoteCheck()?.evidence?.rawOutput).toEqual({
      key: 'agent-trace-artifacts/raw-1.json',
      status: 'stored',
    })
    expect(capturedManifest().integrityRawOutputKey).toBe('agent-trace-artifacts/raw-1.json')
  })

  it('stores nothing when the integrity rules leave the output unchanged', async () => {
    registerIntegrityAgent('native.integrity_unchanged_agent', 'drop')
    runAiAgentObjectMock.mockResolvedValue({
      mode: 'generate',
      object: { kind: 'proposal', proposal: { evidence: [{ quote: 'deliver within 30 days' }] } },
      usage: { inputTokens: 5, outputTokens: 2 },
    })

    await makeService().run('native.integrity_unchanged_agent', { content: CONTENT }, runCtx)

    expect(putArtifactMock).not.toHaveBeenCalled()
    expect(persistedQuoteCheck()?.evidence).not.toHaveProperty('rawOutput')
    expect(capturedManifest()).not.toHaveProperty('integrityRawOutputKey')
  })

  it('records storage_unavailable and still completes the run when the store returns no key', async () => {
    registerIntegrityAgent('native.integrity_raw_unavailable_agent', 'drop')
    mockModelWithToolCall()

    const result = await makeService().run('native.integrity_raw_unavailable_agent', { content: CONTENT }, runCtx)

    expect(result.kind).toBe('proposal')
    expect(completeRunMock).toHaveBeenCalledTimes(1)
    expect(persistedQuoteCheck()?.evidence?.rawOutput).toEqual({ status: 'storage_unavailable' })
    expect(capturedManifest()).not.toHaveProperty('integrityRawOutputKey')
  })

  it('records storage_unavailable and still completes the run when the store throws', async () => {
    registerIntegrityAgent('native.integrity_raw_throw_agent', 'drop')
    mockModelWithToolCall()
    putArtifactMock.mockRejectedValue(new Error('[internal] storage down'))

    const logs = captureLogs()
    try {
      const result = await makeService().run('native.integrity_raw_throw_agent', { content: CONTENT }, runCtx)
      expect(result.kind).toBe('proposal')
      expect(logs.at('warn').map((record) => record.message)).toContain('raw model output offload failed')
    } finally {
      logs.restore()
    }
    expect(completeRunMock).toHaveBeenCalledTimes(1)
    expect(failRunMock).not.toHaveBeenCalled()
    expect(persistedQuoteCheck()?.evidence?.rawOutput).toEqual({ status: 'storage_unavailable' })
  })

  it('does not wire the step hook for agents without integrity when trace capture is off', async () => {
    process.env.OM_AGENT_TRACE_CAPTURE = 'off'
    registerNativeAgent('native.no_integrity_hook_agent')
    runAiAgentObjectMock.mockResolvedValue(VALID_MODEL_OUTPUT)

    const service = makeService()
    await service.run('native.no_integrity_hook_agent', {}, runCtx)

    expect(runAiAgentObjectMock.mock.calls[0][0].loop).toBeUndefined()
  })
})

describe('tool_consulted wiring', () => {
  const consultedSchema = z.object({
    kind: z.literal('proposal'),
    proposal: z.object({ findings: z.array(z.object({ ruleId: z.string() })) }),
  })

  function registerConsultedAgent(id: string, rule: Record<string, unknown> = {}): AgentRegistryEntry {
    const existing = getAgentEntry(id)
    if (existing) return existing
    const entry: AgentRegistryEntry = {
      id,
      moduleId: 'agent_orchestrator',
      resultKind: 'proposal',
      schema: consultedSchema,
      tools: ['acme.get_rule'],
      skills: [],
      subAgents: [],
      label: 'Tool consulted wiring test agent',
      description: 'Proposal agent for tool_consulted wiring tests.',
      instructions: 'propose',
      runtime: 'native',
      integrity: [
        integrityRuleSchema.parse({
          id: 'rules-read',
          kind: 'tool_consulted',
          cites: 'proposal.findings[*].ruleId',
          tools: ['acme.get_rule'],
          returned: ['id'],
          ...rule,
        }),
      ],
    }
    registerFileAgent(entry)
    return entry
  }

  const PROPOSAL = { kind: 'proposal', proposal: { findings: [{ ruleId: 'R1' }] } }

  function toolStep(toolName: string, id: string): Record<string, unknown> {
    return {
      toolCalls: [{ toolCallId: `call-${id}`, toolName, input: { id } }],
      toolResults: [{ toolCallId: `call-${id}`, toolName, output: { id } }],
      finishReason: 'tool-calls',
      usage: { inputTokens: 1, outputTokens: 1 },
      response: { modelId: 'test-model' },
    }
  }

  type LoopArg = {
    onStepFinish?: (event: unknown) => Promise<void>
    prepareStep?: (state: unknown) => unknown
  }

  function persistedConsultedCheck(): { result: string; evidence?: Record<string, unknown> } | undefined {
    const persisted = persistVerdictMock.mock.calls[0][2] as {
      verdict: { checks: Array<{ kind: string; result: string; evidence?: Record<string, unknown> }> }
    }
    return persisted.verdict.checks.find((check) => check.kind === 'tool_consulted')
  }

  it('evaluates from collected tool calls with trace capture off', async () => {
    process.env.OM_AGENT_TRACE_CAPTURE = 'off'
    registerConsultedAgent('native.consulted_trace_off_agent')
    runAiAgentObjectMock.mockImplementation(async (args) => {
      await (args.loop as LoopArg).onStepFinish?.(toolStep('acme__get_rule', 'R1'))
      return { mode: 'generate', object: PROPOSAL, usage: { inputTokens: 1, outputTokens: 1 } }
    })

    await makeService().run('native.consulted_trace_off_agent', {}, runCtx)

    expect(captureNativeRunTraceMock).not.toHaveBeenCalled()
    expect(persistedConsultedCheck()?.result).toBe('pass')
    expect((runAiAgentObjectMock.mock.calls[0][0].loop as LoopArg).prepareStep).toBeUndefined()
  })

  it('flags a citation the run never fetched', async () => {
    registerConsultedAgent('native.consulted_miss_agent')
    runAiAgentObjectMock.mockResolvedValue({ mode: 'generate', object: PROPOSAL, usage: { inputTokens: 1, outputTokens: 1 } })

    const result = await makeService().run('native.consulted_miss_agent', {}, runCtx)

    expect(result).toEqual(PROPOSAL)
    expect(persistedConsultedCheck()).toMatchObject({ result: 'warn', evidence: { holdsAutoApproval: true } })
  })

  it('enforce: prepare_step forces a required tool choice until a matching call succeeded', async () => {
    registerConsultedAgent('native.consulted_enforce_agent', { enforce: 'prepare_step' })
    const observed: unknown[] = []
    runAiAgentObjectMock.mockImplementation(async (args) => {
      const loop = args.loop as LoopArg
      observed.push(await loop.prepareStep?.({}))
      await loop.onStepFinish?.(toolStep('acme__search', 'R1'))
      observed.push(await loop.prepareStep?.({}))
      await loop.onStepFinish?.(toolStep('acme__get_rule', 'R1'))
      observed.push(await loop.prepareStep?.({}))
      return { mode: 'generate', object: PROPOSAL, usage: { inputTokens: 1, outputTokens: 1 } }
    })

    await makeService().run('native.consulted_enforce_agent', {}, runCtx)

    expect(observed).toEqual([{ toolChoice: 'required' }, { toolChoice: 'required' }, undefined])
    expect(persistedConsultedCheck()?.result).toBe('pass')
  })

  it('shadow mode does not install the prepare-step enforcement', async () => {
    process.env.OM_AGENT_INTEGRITY = 'off'
    registerConsultedAgent('native.consulted_enforce_shadow_agent', { enforce: 'prepare_step' })
    runAiAgentObjectMock.mockResolvedValue({ mode: 'generate', object: PROPOSAL, usage: { inputTokens: 1, outputTokens: 1 } })

    await makeService().run('native.consulted_enforce_shadow_agent', {}, runCtx)

    expect((runAiAgentObjectMock.mock.calls[0][0].loop as LoopArg).prepareStep).toBeUndefined()
  })

  it('includeSubRuns counts the tool calls of an in-process nested run', async () => {
    const service = makeService()
    registerConsultedAgent('native.consulted_parent_agent', { includeSubRuns: true })
    registerNativeAgent('native.consulted_child_agent')
    registerConsultedAgent('native.consulted_parent_no_sub_agent')
    runAiAgentObjectMock.mockImplementation(async (args) => {
      if (args.agentId === 'native.consulted_child_agent') {
        await (args.loop as LoopArg).onStepFinish?.(toolStep('acme__get_rule', 'R1'))
        return VALID_MODEL_OUTPUT
      }
      await service.run('native.consulted_child_agent', {}, runCtx)
      return { mode: 'generate', object: PROPOSAL, usage: { inputTokens: 1, outputTokens: 1 } }
    })

    await service.run('native.consulted_parent_agent', {}, runCtx)
    const parentCheck = persistVerdictMock.mock.calls
      .map((call) => call[2] as { verdict: { checks: Array<{ kind: string; result: string }> } })
      .flatMap((persisted) => persisted.verdict.checks)
      .find((check) => check.kind === 'tool_consulted')
    expect(parentCheck?.result).toBe('pass')

    persistVerdictMock.mockClear()
    await service.run('native.consulted_parent_no_sub_agent', {}, runCtx)
    const withoutSubRuns = persistVerdictMock.mock.calls
      .map((call) => call[2] as { verdict: { checks: Array<{ kind: string; result: string }> } })
      .flatMap((persisted) => persisted.verdict.checks)
      .find((check) => check.kind === 'tool_consulted')
    expect(withoutSubRuns?.result).toBe('warn')
  })
})
