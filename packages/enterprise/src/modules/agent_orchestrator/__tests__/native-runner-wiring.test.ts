// Native-runner wiring tests (lightweight-agent-runtime Phase 1+2): the run row
// is stamped `(runtime='native', externalRunId=runId)`, per-step records reach
// the post-run trace capture on success AND failure, a capture failure never
// fails the run, and the model call runs under the provider budget.

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
  shapeResult: (kind: 'informative' | 'actionable', data: unknown) => {
    const record = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
    return kind === 'informative'
      ? { kind: 'informative', data: 'data' in record ? record.data : data }
      : { kind: 'actionable', proposal: record.proposal ?? data }
  },
}))

jest.mock('../lib/guardrails/guardrailService', () => ({
  GUARDRAIL_SET_VERSION: 'test-version',
  persistVerdict: jest.fn(async () => ({})),
  GuardrailService: class {
    async checkInput() {
      return { result: 'pass', checks: [] }
    }
    async checkOutput() {
      return { result: 'pass', checks: [] }
    }
  },
}))
jest.mock('../lib/guardrails/syncGroundingSets', () => ({
  resolveCurrentGroundingSet: jest.fn(async () => null),
}))

const captureNativeRunTraceMock = jest.fn<Promise<void>, unknown[]>()
jest.mock('../lib/runtime/nativeTraceCapture', () => {
  const actual = jest.requireActual('../lib/runtime/nativeTraceCapture')
  return {
    ...actual,
    captureNativeRunTrace: (...args: unknown[]) => captureNativeRunTraceMock(...args),
  }
})

import { z } from 'zod'
import { AgentRuntimeService } from '../lib/runtime/agentRuntime'
import { registerFileAgent, getAgentEntry, type AgentRegistryEntry } from '../lib/sdk/defineAgent'
import { resetAgentAdmissionForTests } from '../lib/runtime/admission'
import { resetProviderBudgetForTests } from '../lib/runtime/providerBudget'
import type { NativeTraceInput } from '../lib/runtime/nativeTraceCapture'

function registerNativeAgent(id: string): AgentRegistryEntry {
  const existing = getAgentEntry(id)
  if (existing) return existing
  const entry: AgentRegistryEntry = {
    id,
    moduleId: 'agent_orchestrator',
    resultKind: 'informative',
    schema: z.object({ kind: z.literal('informative'), data: z.unknown() }),
    tools: [],
    skills: [],
    subAgents: [],
    label: 'Native wiring test agent',
    description: 'Informative agent for native-runner wiring tests.',
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

const VALID_MODEL_OUTPUT = { mode: 'generate', object: { kind: 'informative', data: { ok: true } }, usage: { inputTokens: 9, outputTokens: 3 } }
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
  delete process.env.OM_AGENT_TRACE_CAPTURE
})

afterEach(() => {
  resetAgentAdmissionForTests()
  resetProviderBudgetForTests()
  delete process.env.OM_AGENT_TRACE_CAPTURE
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
    expect(result.kind).toBe('informative')
    expect(observed).toHaveLength(1)
    expect(observed[0]).toMatch(/^run-\d+$/)

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const result2 = await service.run('native.hook_agent', {}, {
        ...runCtx,
        onRunPersisted: () => {
          throw new Error('[internal] hook boom')
        },
      })
      expect(result2.kind).toBe('informative')
      expect(warnSpy).toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('dispatches a legacy in-process entry to the same native runner', async () => {
    const entry: AgentRegistryEntry = {
      id: 'native.legacy_alias_agent',
      moduleId: 'agent_orchestrator',
      resultKind: 'informative',
      schema: z.object({ kind: z.literal('informative'), data: z.unknown() }),
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
    expect(result.kind).toBe('informative')
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
    expect(result.kind).toBe('informative')
    await flushMicrotasks()
    expect(completeRunMock).toHaveBeenCalledTimes(1)
    expect(failRunMock).not.toHaveBeenCalled()
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
  it('stamps confidence from the proposal and computed cost on an actionable run', async () => {
    const entry: AgentRegistryEntry = {
      id: 'native.cost_stamp_agent',
      moduleId: 'agent_orchestrator',
      resultKind: 'actionable',
      schema: z.object({
        kind: z.literal('actionable'),
        proposal: z.object({ confidence: z.number().optional() }).passthrough(),
      }),
      tools: [],
      skills: [],
      subAgents: [],
      label: 'Cost stamp agent',
      description: 'Actionable agent for stamping tests.',
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
        object: { kind: 'actionable', proposal: { confidence: 0.83 } },
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

  it('informative run: null confidence, fallback usage, no cost without a priced model', async () => {
    registerNativeAgent('native.informative_stamp_agent')
    runAiAgentObjectMock.mockResolvedValue(VALID_MODEL_OUTPUT)

    const service = makeService()
    await service.run('native.informative_stamp_agent', {}, runCtx)

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
