// Runtime-protection tests (performance hardening Phase 2): the in-process
// wall-clock timeout and the top-level admission gate in AgentRuntimeService.
// The model execution and the persistence/guardrail helpers are mocked so the
// tests exercise ONLY the runtime's protection wiring.

const runAiAgentObjectMock = jest.fn<Promise<unknown>, [{ agentId: string }]>()
jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-runtime', () => ({
  runAiAgentObject: (args: { agentId: string }) => runAiAgentObjectMock(args),
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

import { z } from 'zod'
import { AgentRuntimeService, AgentRunTimeoutError } from '../lib/runtime/agentRuntime'
import { registerFileAgent, getAgentEntry, type AgentRegistryEntry } from '../lib/sdk/defineAgent'
import { resetAgentAdmissionForTests, isAgentCapacityError } from '../lib/runtime/admission'

const PROTECTION_ENV_KEYS = [
  'OM_AGENT_RUN_TIMEOUT_MS',
  'OM_AGENT_MAX_CONCURRENT_RUNS',
  'OM_AGENT_MAX_CONCURRENT_RUNS_PER_TENANT',
  'OM_AGENT_ADMISSION_MAX_WAIT_MS',
  'OM_AGENT_ADMISSION_MAX_QUEUE',
] as const

function registerInProcessAgent(id: string): AgentRegistryEntry {
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
    label: 'Protection test agent',
    description: 'Informative agent for runtime-protection tests.',
    instructions: 'inform',
    runtime: 'in-process',
  }
  registerFileAgent(entry)
  return entry
}

function makeService(): AgentRuntimeService {
  const registrations: Record<string, unknown> = {
    em: { fork: () => ({}) },
  }
  const container = {
    resolve(name: string) {
      if (name in registrations) return registrations[name]
      throw new Error(`[internal] unexpected resolve("${name}")`)
    },
  }
  return new AgentRuntimeService({ container: container as never, commandBus: {} as never })
}

const VALID_MODEL_OUTPUT = { mode: 'generate', object: { kind: 'informative', data: { ok: true } } }
const runCtx = { tenantId: 'tenant-1', organizationId: 'org-1', userId: 'user-1' }

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

let runSeq = 0

beforeEach(() => {
  runAiAgentObjectMock.mockReset()
  createRunMock.mockReset().mockImplementation(async () => `run-${++runSeq}`)
  completeRunMock.mockReset().mockResolvedValue(undefined)
  failRunMock.mockReset().mockResolvedValue(undefined)
  createProposalMock.mockReset().mockResolvedValue(undefined)
  for (const key of PROTECTION_ENV_KEYS) delete process.env[key]
})

afterEach(() => {
  resetAgentAdmissionForTests()
  for (const key of PROTECTION_ENV_KEYS) delete process.env[key]
})

describe('in-process wall-clock timeout (OM_AGENT_RUN_TIMEOUT_MS)', () => {
  it('fails the run exactly once, throws AgentRunTimeoutError, and ignores the late model result', async () => {
    process.env.OM_AGENT_RUN_TIMEOUT_MS = '30'
    registerInProcessAgent('protection.timeout_agent')
    runAiAgentObjectMock.mockImplementation(
      () => delay(150).then(() => VALID_MODEL_OUTPUT),
    )

    const service = makeService()
    await expect(
      service.run('protection.timeout_agent', { x: 1 }, runCtx),
    ).rejects.toBeInstanceOf(AgentRunTimeoutError)

    expect(failRunMock).toHaveBeenCalledTimes(1)
    const failInput = failRunMock.mock.calls[0][2] as { errorMessage: string }
    expect(failInput.errorMessage).toContain('wall-clock deadline')
    expect(completeRunMock).not.toHaveBeenCalled()

    // Let the late model resolution arrive: it must neither complete the run
    // nor fail it a second time.
    await delay(200)
    expect(completeRunMock).not.toHaveBeenCalled()
    expect(createProposalMock).not.toHaveBeenCalled()
    expect(failRunMock).toHaveBeenCalledTimes(1)
  })

  it('completes normally when the model finishes inside the deadline', async () => {
    process.env.OM_AGENT_RUN_TIMEOUT_MS = '5000'
    registerInProcessAgent('protection.fast_agent')
    runAiAgentObjectMock.mockResolvedValue(VALID_MODEL_OUTPUT)

    const service = makeService()
    const result = await service.run('protection.fast_agent', { x: 1 }, runCtx)

    expect(result.kind).toBe('informative')
    expect(completeRunMock).toHaveBeenCalledTimes(1)
    expect(failRunMock).not.toHaveBeenCalled()
  })
})

describe('admission gate in AgentRuntimeService.run', () => {
  it('a nested run (parentRunId set) bypasses admission while the gate is saturated', async () => {
    process.env.OM_AGENT_MAX_CONCURRENT_RUNS = '1'
    process.env.OM_AGENT_ADMISSION_MAX_WAIT_MS = '60'
    registerInProcessAgent('protection.parent_agent')
    registerInProcessAgent('protection.child_agent')

    let releaseModel: (() => void) | null = null
    runAiAgentObjectMock.mockImplementation(({ agentId }) => {
      if (agentId === 'protection.parent_agent') {
        return new Promise((resolve) => {
          releaseModel = () => resolve(VALID_MODEL_OUTPUT)
        })
      }
      return Promise.resolve(VALID_MODEL_OUTPUT)
    })

    const service = makeService()
    const parentRun = service.run('protection.parent_agent', {}, runCtx)
    for (let i = 0; i < 50 && releaseModel === null; i += 1) await delay(1)
    expect(releaseModel).not.toBeNull()

    // The single global slot is held by the parent: a TOP-LEVEL run is turned
    // away by the bounded wait…
    let capacityError: unknown = null
    try {
      await service.run('protection.child_agent', {}, runCtx)
    } catch (err) {
      capacityError = err
    }
    expect(isAgentCapacityError(capacityError)).toBe(true)

    // …while a NESTED run (parent run id present) bypasses the gate entirely.
    const nestedResult = await service.run('protection.child_agent', {}, {
      ...runCtx,
      parentRunId: 'run-parent',
    })
    expect(nestedResult.kind).toBe('informative')

    releaseModel!()
    await expect(parentRun).resolves.toMatchObject({ kind: 'informative' })
  })

  it('a top-level run releases its slot on success and on error', async () => {
    process.env.OM_AGENT_MAX_CONCURRENT_RUNS = '1'
    process.env.OM_AGENT_ADMISSION_MAX_WAIT_MS = '60'
    registerInProcessAgent('protection.release_agent')

    const service = makeService()

    runAiAgentObjectMock.mockResolvedValueOnce(VALID_MODEL_OUTPUT)
    await service.run('protection.release_agent', {}, runCtx)

    // The slot from the successful run is free again.
    runAiAgentObjectMock.mockRejectedValueOnce(new Error('[internal] model exploded'))
    await expect(service.run('protection.release_agent', {}, runCtx)).rejects.toThrow('model exploded')
    expect(failRunMock).toHaveBeenCalledTimes(1)

    // The slot from the failed run is free again too.
    runAiAgentObjectMock.mockResolvedValueOnce(VALID_MODEL_OUTPUT)
    const result = await service.run('protection.release_agent', {}, runCtx)
    expect(result.kind).toBe('informative')
  })
})
