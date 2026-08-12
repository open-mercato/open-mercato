/**
 * The START half of the external runtime (external-agent-invocation design §5.2;
 * tracker task 2.3).
 *
 * What is load-bearing here:
 *
 * 1. Starting an external run hands the provider a PLAINTEXT single-use token and
 *    persists only its SHA-256 digest. A correlation table that stored the bearer
 *    would make every row a forgeable callback.
 * 2. The run SUSPENDS: it returns a marker, never completes, and holds nothing —
 *    the workflow step parks and the provider answers minutes later.
 * 3. The pre-call input guardrail screens the brief we are about to send OUTWARD.
 *    A block must fail the run with `connector.start` never reached: nothing
 *    leaves the building.
 * 4. Dispatch is an explicit runtime switch. Before this task anything that was
 *    not `'opencode'` fell through to the native runner, so an external agent
 *    would have been run as an empty LLM prompt.
 */

// Keep the cross-module aggregator and the file-agent manifest out of the registry
// so only the agents this file declares are in play.
jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-registry', () => ({
  loadAgentRegistry: () => Promise.reject(new Error('skip aggregator in test')),
}))
jest.mock('../generated/file-agents.generated', () => ({ fileAgentDescriptors: [] }))

const runAiAgentObjectMock = jest.fn<Promise<unknown>, [Record<string, unknown>]>()
jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-runtime', () => ({
  runAiAgentObject: (args: Record<string, unknown>) => runAiAgentObjectMock(args),
}))
jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/model-factory', () => ({
  createModelFactory: () => ({
    resolveModel: () => ({ providerId: 'test-provider', modelId: 'test-model', model: {}, source: 'env_default' }),
  }),
}))

const openCodeRunMock = jest.fn<Promise<unknown>, unknown[]>()
jest.mock('../lib/runtime/openCodeAgentRunner', () => ({
  OpenCodeAgentRunner: class {
    run(...args: unknown[]) {
      return openCodeRunMock(...args)
    }
  },
}))

const createRunMock = jest.fn<Promise<string>, unknown[]>()
const completeRunMock = jest.fn<Promise<void>, unknown[]>()
const failRunMock = jest.fn<Promise<void>, unknown[]>()
const createExternalRunRowMock = jest.fn<Promise<string>, unknown[]>()
const claimExternalRunRowMock = jest.fn<Promise<boolean>, unknown[]>()
const settleExternalRunRowMock = jest.fn<Promise<boolean>, unknown[]>()
jest.mock('../lib/runtime/persistence', () => {
  const actual = jest.requireActual('../lib/runtime/persistence')
  return {
    buildCommandContext: () => ({}),
    // T2.8: the runner now gates outbound contact on a default-off ACL feature, so
    // every case in THIS file — which is about the start mechanics, not the gate —
    // runs as a principal that holds it. The gate itself (grant, denial, wildcard,
    // superadmin, fail-closed) is covered in `external-run-wiring.test.ts`.
    resolveCallerAcl: async () => ({
      features: ['agent_orchestrator.external_agents.invoke'],
      isSuperAdmin: false,
    }),
    shapeResult: actual.shapeResult,
    createRun: (...args: unknown[]) => createRunMock(...args),
    completeRun: (...args: unknown[]) => completeRunMock(...args),
    failRun: (...args: unknown[]) => failRunMock(...args),
    createExternalRunRow: (...args: unknown[]) => createExternalRunRowMock(...args),
    claimExternalRunRow: (...args: unknown[]) => claimExternalRunRowMock(...args),
    settleExternalRunRow: (...args: unknown[]) => settleExternalRunRowMock(...args),
    createProposal: jest.fn(async () => undefined),
  }
})

/**
 * The deadline job the runner enqueues once the call is placed (T2.7). Mocked
 * because the real helper reaches the module queue, and a unit test must not
 * write into `.mercato/queue`; what the DEADLINE then does with the job is
 * `external-run-expiry.test.ts`'s subject.
 */
const enqueueDeadlineSweepMock = jest.fn<Promise<void>, unknown[]>()
jest.mock('../lib/runtime/externalRunSweep', () => ({
  enqueueExternalRunDeadlineSweep: (...args: unknown[]) => enqueueDeadlineSweepMock(...args),
}))

const checkInputMock = jest.fn(async () => ({ result: 'pass', checks: [] as unknown[] }))
jest.mock('../lib/guardrails/guardrailService', () => ({
  GUARDRAIL_SET_VERSION: 'test-version',
  persistVerdict: jest.fn(async () => ({})),
  GuardrailService: class {
    checkInput(...args: unknown[]) {
      return checkInputMock(...(args as []))
    }
    async checkOutput() {
      return { result: 'pass', checks: [] }
    }
  },
}))
jest.mock('../lib/guardrails/syncGroundingSets', () => ({
  resolveCurrentGroundingSet: jest.fn(async () => null),
}))

import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { AwilixContainer } from 'awilix'
import { AgentRuntimeService } from '../lib/runtime/agentRuntime'
import {
  AgentGuardrailBlockedError,
  AgentOutputInvalidError,
  AgentRunSuspendedError,
  ExternalAgentConfigurationError,
  UnknownAgentRuntimeError,
} from '../lib/runtime/errors'
import { registerFileAgent, getAgentEntry, type AgentRegistryEntry, type AgentRuntime } from '../lib/sdk/defineAgent'
import {
  clearExternalAgentConnectorsForTests,
  registerExternalAgentConnector,
  type ExternalAgentConnector,
  type ExternalAgentConnectorStartArgs,
} from '../lib/runtime/externalConnectorRegistry'
import { resetAgentAdmissionForTests } from '../lib/runtime/admission'

const CONNECTOR_ID = 'test.voice'
const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const PROCESS_ID = '33333333-3333-4333-8333-333333333333'

const outcomeEnvelope = z.object({
  kind: z.literal('researcher'),
  data: z.object({ reached: z.boolean(), transcript: z.string() }),
})

const runCtx = { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID, userId: 'user-1' }
const workflowRunCtx = { ...runCtx, processId: PROCESS_ID, stepId: 'call_owner' }

function registerAgent(id: string, overrides: Partial<AgentRegistryEntry> = {}): AgentRegistryEntry {
  const existing = getAgentEntry(id)
  if (existing) return existing
  const entry: AgentRegistryEntry = {
    id,
    moduleId: 'voice_agents',
    resultKind: 'researcher',
    schema: outcomeEnvelope,
    tools: [],
    skills: [],
    subAgents: [],
    label: 'External test agent',
    description: 'External researcher agent for runner tests.',
    instructions: '',
    runtime: 'external',
    connectorId: CONNECTOR_ID,
    callbackTimeoutMs: 30 * 60 * 1000,
    ...overrides,
  }
  registerFileAgent(entry)
  return entry
}

function makeService(): AgentRuntimeService {
  const container = {
    resolve(name: string) {
      if (name === 'em') return { fork: () => ({}) }
      if (name === 'openCodeClient') return {}
      throw new Error(`[internal] unexpected resolve("${name}")`)
    },
  } as unknown as AwilixContainer
  return new AgentRuntimeService({ container, commandBus: {} as never })
}

let startArgs: ExternalAgentConnectorStartArgs[] = []

function stubConnector(overrides: Partial<ExternalAgentConnector> = {}): ExternalAgentConnector {
  return {
    id: CONNECTOR_ID,
    start: async (args) => {
      startArgs.push(args)
      return { externalRunId: 'conv-1', expectsCallback: true }
    },
    verifyCallback: () => true,
    normalize: (raw) => raw,
    ...overrides,
  }
}

let runSeq = 0

/**
 * Await a call that MUST reject and hand back the rejection, typed. `.catch(err =>
 * err as T)` would type the result as `T | <resolved value>`, which hides an
 * assertion that silently stopped testing anything once the call stopped throwing.
 */
async function captureRejection<T>(promise: Promise<unknown>): Promise<T> {
  let rejection: unknown
  let rejected = false
  await promise.then(
    () => undefined,
    (err: unknown) => {
      rejection = err
      rejected = true
    },
  )
  if (!rejected) throw new Error('[internal] expected the call to reject, but it resolved')
  return rejection as T
}

beforeEach(() => {
  startArgs = []
  runSeq = 0
  clearExternalAgentConnectorsForTests()
  checkInputMock.mockReset().mockResolvedValue({ result: 'pass', checks: [] })
  createRunMock.mockReset().mockImplementation(async () => `run-${++runSeq}`)
  completeRunMock.mockReset().mockResolvedValue(undefined)
  failRunMock.mockReset().mockResolvedValue(undefined)
  createExternalRunRowMock.mockReset().mockResolvedValue('external-row-1')
  enqueueDeadlineSweepMock.mockReset().mockResolvedValue(undefined)
  claimExternalRunRowMock.mockReset().mockResolvedValue(true)
  settleExternalRunRowMock.mockReset().mockResolvedValue(true)
  runAiAgentObjectMock.mockReset()
  openCodeRunMock.mockReset()
  process.env.APP_URL = 'https://app.example.com'
})

afterEach(() => {
  resetAgentAdmissionForTests()
  delete process.env.APP_URL
})

describe('starting an external agent run', () => {
  it('starts the connector, persists only the token DIGEST, and returns a suspended marker', async () => {
    registerAgent('voice.happy_path')
    registerExternalAgentConnector(stubConnector())

    const outcome = await makeService().runOrSuspend('voice.happy_path', { brief: 'deal at risk' }, workflowRunCtx)

    expect(outcome).toEqual({ kind: 'suspended', runId: 'run-1', externalRunId: 'conv-1' })

    // The run row is opened as an EXTERNAL run whose externalRunId is our own uuid
    // (the provider id is not known yet, and `agent_runs_runtime_external_uq` has
    // no tenancy column, so a provider id there would collide across tenants).
    const createInput = createRunMock.mock.calls[0][2] as Record<string, unknown>
    expect(createInput.runtime).toBe('external')
    expect(createInput.stampExternalRunIdFromId).toBe(true)
    expect(createInput.processId).toBe(PROCESS_ID)

    // The connector was handed a plaintext token and an absolute callback URL
    // carrying that same token.
    expect(startArgs).toHaveLength(1)
    const { callbackToken, callbackUrl, scope, input } = startArgs[0]
    expect(callbackToken).toMatch(/^xrun_[0-9a-f]{64}$/)
    expect(callbackUrl).toBe(
      `https://app.example.com/api/agent_orchestrator/external-runs/${callbackToken}/callback`,
    )
    expect(scope).toEqual({ tenantId: TENANT_ID, organizationId: ORGANIZATION_ID })
    expect(input).toEqual({ brief: 'deal at risk' })

    // The correlation row stores the digest and NOT the bearer.
    const rowInput = createExternalRunRowMock.mock.calls[0][2] as Record<string, unknown>
    const expectedHash = createHash('sha256').update(callbackToken).digest('hex')
    expect(rowInput.callbackTokenHash).toBe(expectedHash)
    expect(rowInput.callbackTokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(rowInput.callbackTokenHash).not.toBe(callbackToken)
    expect(JSON.stringify(rowInput)).not.toContain(callbackToken)

    expect(rowInput.runId).toBe('run-1')
    expect(rowInput.connectorId).toBe(CONNECTOR_ID)
    expect(rowInput.externalRunId).toBe('conv-1')
    expect(rowInput.status).toBe('pending')
    // The resume triple is all-or-nothing and names the signal a parked
    // INVOKE_AGENT step waits on.
    expect(rowInput.processId).toBe(PROCESS_ID)
    expect(rowInput.stepId).toBe('call_owner')
    expect(rowInput.signalName).toBe('agent_orchestrator.proposal.ready')
    expect((rowInput.expiresAt as Date).getTime()).toBeGreaterThan(Date.now() + 29 * 60 * 1000)

    // Suspended means UNSETTLED: the run stays `running` until the callback.
    expect(completeRunMock).not.toHaveBeenCalled()
    expect(failRunMock).not.toHaveBeenCalled()

    // A suspension is only safe because something will come back for it. The
    // deadline job is enqueued for THIS correlation row, with the same deadline
    // the row carries, so a call nobody answers is released rather than parking
    // the workflow forever (T2.7, risk R2).
    expect(enqueueDeadlineSweepMock).toHaveBeenCalledTimes(1)
    expect(enqueueDeadlineSweepMock.mock.calls[0][0]).toEqual({
      externalRunRowId: 'external-row-1',
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      runId: 'run-1',
      expiresAt: rowInput.expiresAt,
    })
  })

  it('writes no resume triple for a non-workflow invocation', async () => {
    registerAgent('voice.no_workflow')
    registerExternalAgentConnector(stubConnector())

    await makeService().runOrSuspend('voice.no_workflow', {}, runCtx)

    const rowInput = createExternalRunRowMock.mock.calls[0][2] as Record<string, unknown>
    expect(rowInput.processId).toBeNull()
    expect(rowInput.stepId).toBeNull()
    expect(rowInput.signalName).toBeNull()
  })

  it('surfaces a suspension to a legacy `run()` caller as a NON-retryable typed error', async () => {
    registerAgent('voice.legacy_caller')
    registerExternalAgentConnector(stubConnector())

    await expect(makeService().run('voice.legacy_caller', {}, runCtx)).rejects.toBeInstanceOf(
      AgentRunSuspendedError,
    )
    // The external effector already ran — a retry would place a second call.
    const error = await captureRejection<AgentRunSuspendedError>(
      makeService().run('voice.legacy_caller', {}, runCtx),
    )
    expect(error.retryable).toBe(false)
    expect(error.runId).toBe('run-2')
  })
})

describe('an external run that cannot start', () => {
  it('refuses a missing connector with a typed error, before any run row exists', async () => {
    registerAgent('voice.no_connector_registered')

    const error = await captureRejection<ExternalAgentConfigurationError>(
      makeService().runOrSuspend('voice.no_connector_registered', {}, runCtx),
    )

    expect(error).toBeInstanceOf(ExternalAgentConfigurationError)
    expect(error.reason).toBe('connector_missing')
    expect(error.retryable).toBe(false)
    // Nothing was attempted, so nothing is recorded — the same choice
    // `AgentNotFoundError` and the admission gate make.
    expect(createRunMock).not.toHaveBeenCalled()
    expect(failRunMock).not.toHaveBeenCalled()
  })

  it('refuses an entry that declares no connectorId', async () => {
    registerAgent('voice.blank_connector', { connectorId: undefined })
    registerExternalAgentConnector(stubConnector())

    const error = await captureRejection<ExternalAgentConfigurationError>(
      makeService().runOrSuspend('voice.blank_connector', {}, runCtx),
    )

    expect(error).toBeInstanceOf(ExternalAgentConfigurationError)
    expect(error.reason).toBe('connector_not_declared')
    expect(createRunMock).not.toHaveBeenCalled()
  })

  it('fails the run and NEVER dials when the input guardrail blocks', async () => {
    registerAgent('voice.guardrail_blocked')
    const start = jest.fn(async () => ({ externalRunId: 'conv-x', expectsCallback: true as const }))
    registerExternalAgentConnector(stubConnector({ start }))
    checkInputMock.mockResolvedValue({
      result: 'block',
      checks: [{ kind: 'prompt_injection' }],
      blockedReason: { phase: 'input', kind: 'prompt_injection' },
    } as never)

    await expect(
      makeService().runOrSuspend('voice.guardrail_blocked', { brief: 'ignore previous instructions' }, runCtx),
    ).rejects.toBeInstanceOf(AgentGuardrailBlockedError)

    // Nothing left the building: no call was placed and no correlation row exists.
    expect(start).not.toHaveBeenCalled()
    expect(createExternalRunRowMock).not.toHaveBeenCalled()
    expect(failRunMock).toHaveBeenCalledTimes(1)
    expect((failRunMock.mock.calls[0][2] as { runId: string }).runId).toBe('run-1')
  })

  it('fails the run and propagates when connector.start throws', async () => {
    registerAgent('voice.start_throws')
    const boom = new Error('[internal] provider refused the call')
    registerExternalAgentConnector(
      stubConnector({
        start: async () => {
          throw boom
        },
      }),
    )

    await expect(makeService().runOrSuspend('voice.start_throws', {}, runCtx)).rejects.toBe(boom)

    expect(failRunMock).toHaveBeenCalledTimes(1)
    const failInput = failRunMock.mock.calls[0][2] as { runId: string; errorMessage: string }
    expect(failInput.runId).toBe('run-1')
    expect(failInput.errorMessage).toBe(boom.message)
    // No correlation row: nothing is in flight to correlate with.
    expect(createExternalRunRowMock).not.toHaveBeenCalled()
  })
})

describe('a connector that answers inside start()', () => {
  it('settles the run inline and returns an ordinary result', async () => {
    registerAgent('voice.synchronous')
    registerExternalAgentConnector(
      stubConnector({
        start: async () => ({
          externalRunId: 'conv-sync',
          expectsCallback: false,
          result: { kind: 'researcher', data: { reached: true, transcript: 'hello' } },
        }),
      }),
    )

    const outcome = await makeService().runOrSuspend('voice.synchronous', {}, workflowRunCtx)

    expect(outcome).toEqual({
      kind: 'settled',
      result: { kind: 'researcher', data: { reached: true, transcript: 'hello' } },
    })
    expect(completeRunMock).toHaveBeenCalledTimes(1)

    // The row is born `pending` and settled through the SAME completion function
    // the callback arm uses — that is what gives the synchronous arm the output
    // guardrail and the single-shot claim it lacked before T2.4.
    const rowInput = createExternalRunRowMock.mock.calls[0][2] as Record<string, unknown>
    expect(rowInput.status).toBe('pending')
    expect(rowInput).not.toHaveProperty('resultPayload')
    // Nothing will call back, so it carries no resume triple — the step never parked.
    expect(rowInput.processId).toBeNull()
    expect(rowInput.signalName).toBeNull()
    // And no deadline job: the answer is already here, so there is no wait to
    // enforce and a job would only wake to find the row settled.
    expect(enqueueDeadlineSweepMock).not.toHaveBeenCalled()

    expect(claimExternalRunRowMock).toHaveBeenCalledTimes(1)
    expect((claimExternalRunRowMock.mock.calls[0][2] as { status: string }).status).toBe('completed')
    const settleInput = settleExternalRunRowMock.mock.calls[0][2] as Record<string, unknown>
    expect(settleInput.status).toBe('completed')
    expect(settleInput.resultPayload).toEqual({
      kind: 'researcher',
      data: { reached: true, transcript: 'hello' },
    })
  })

  it('fails the run when the connector answers with a payload the agent never promised', async () => {
    registerAgent('voice.synchronous_invalid')
    registerExternalAgentConnector(
      stubConnector({
        start: async () => ({
          externalRunId: 'conv-sync-bad',
          expectsCallback: false,
          result: { kind: 'researcher', data: { reached: 'yes please' } },
        }),
      }),
    )

    await expect(
      makeService().runOrSuspend('voice.synchronous_invalid', {}, runCtx),
    ).rejects.toBeInstanceOf(AgentOutputInvalidError)

    expect(completeRunMock).not.toHaveBeenCalled()
    expect(failRunMock).toHaveBeenCalledTimes(1)
    expect((settleExternalRunRowMock.mock.calls[0][2] as { status: string }).status).toBe('failed')
  })
})

describe('runtime dispatch', () => {
  it('routes `external` to the external runner', async () => {
    registerAgent('dispatch.external')
    registerExternalAgentConnector(stubConnector())

    const outcome = await makeService().runOrSuspend('dispatch.external', {}, runCtx)

    expect(outcome.kind).toBe('suspended')
    expect(startArgs).toHaveLength(1)
    expect(runAiAgentObjectMock).not.toHaveBeenCalled()
  })

  it.each(['native', 'in-process'] as const)('routes `%s` to the native runner', async (runtime) => {
    registerAgent(`dispatch.${runtime}`, {
      runtime,
      connectorId: undefined,
      callbackTimeoutMs: undefined,
    })
    runAiAgentObjectMock.mockResolvedValue({
      mode: 'generate',
      object: { kind: 'researcher', data: { reached: true, transcript: 'x' } },
      usage: { inputTokens: 1, outputTokens: 1 },
    })

    const outcome = await makeService().runOrSuspend(`dispatch.${runtime}`, {}, runCtx)

    expect(outcome).toEqual({
      kind: 'settled',
      result: { kind: 'researcher', data: { reached: true, transcript: 'x' } },
    })
    expect(runAiAgentObjectMock).toHaveBeenCalledTimes(1)
  })

  it('routes `opencode` to the OpenCode runner', async () => {
    registerAgent('dispatch.opencode', {
      runtime: 'opencode',
      connectorId: undefined,
      callbackTimeoutMs: undefined,
    })
    openCodeRunMock.mockResolvedValue({ kind: 'researcher', data: { ok: true } })

    const outcome = await makeService().runOrSuspend('dispatch.opencode', {}, runCtx)

    expect(outcome).toEqual({ kind: 'settled', result: { kind: 'researcher', data: { ok: true } } })
    expect(runAiAgentObjectMock).not.toHaveBeenCalled()
  })

  it('REFUSES an unrecognised runtime instead of falling through to the native runner', async () => {
    registerAgent('dispatch.martian', {
      runtime: 'martian' as unknown as AgentRuntime,
      connectorId: undefined,
      callbackTimeoutMs: undefined,
    })

    const error = await captureRejection<UnknownAgentRuntimeError>(
      makeService().runOrSuspend('dispatch.martian', {}, runCtx),
    )

    expect(error).toBeInstanceOf(UnknownAgentRuntimeError)
    expect(error.runtime).toBe('martian')
    expect(error.retryable).toBe(false)
    // The regression this guards: an unknown runtime must never reach an LLM, and
    // must not open a run row for work nobody can execute.
    expect(runAiAgentObjectMock).not.toHaveBeenCalled()
    expect(createRunMock).not.toHaveBeenCalled()
  })
})
