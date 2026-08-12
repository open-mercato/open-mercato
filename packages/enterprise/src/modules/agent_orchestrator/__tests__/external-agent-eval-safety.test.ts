/**
 * Eval / dry-run parity for the `external` runtime (tracker task 3.3).
 *
 * WHY THIS FILE IS SAFETY-CRITICAL RATHER THAN POLISH. A workflow DRY RUN never
 * reaches the agent bridge — `INVOKE_AGENT` carries an activity-level `mock` and
 * core's `executeActivity` swaps it in at the one place `entry.execute` is called
 * (covered by `packages/core/.../workflows/lib/__tests__/dry-run.test.ts`). The
 * EVAL path has no such short-circuit: `lib/eval/evalReplayService.ts` calls
 * `agentRuntime.run()` for real, so replaying a fifty-case suite against a voice
 * agent would place fifty real phone calls to real people.
 *
 * Before this task that was held closed only by the ElevenLabs connector happening
 * to omit `mock` — which did nothing, because NOTHING read `connector.mock`. The
 * refusal was documented in the registry and absent from the runner. What is
 * asserted here is the structural version:
 *
 * 1. An eval replay of an external agent whose connector has no `mock` REFUSES,
 *    and `connector.start` is NEVER called. That single assertion is the point of
 *    the file; a version of these tests that passed because the connector declined
 *    to dial would be worthless.
 * 2. A connector that DOES provide `mock` is simulated: `start` is still never
 *    called, and the result is unmistakably marked simulated rather than dressed
 *    up as an answer.
 * 3. Production traffic — including the Playground — is completely unaffected.
 */

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
jest.mock('../lib/runtime/persistence', () => {
  const actual = jest.requireActual('../lib/runtime/persistence')
  return {
    buildCommandContext: () => ({}),
    // The outbound-contact ACL gate is not this file's subject, so every case runs
    // as a principal that holds it — otherwise a refusal here could be the ACL
    // refusing rather than the simulation gate, and the tests would pass for the
    // wrong reason.
    resolveCallerAcl: async () => ({
      features: ['agent_orchestrator.external_agents.invoke'],
      isSuperAdmin: false,
    }),
    shapeResult: actual.shapeResult,
    createRun: (...args: unknown[]) => createRunMock(...args),
    completeRun: (...args: unknown[]) => completeRunMock(...args),
    failRun: (...args: unknown[]) => failRunMock(...args),
    createExternalRunRow: (...args: unknown[]) => createExternalRunRowMock(...args),
    claimExternalRunRow: jest.fn(async () => true),
    settleExternalRunRow: jest.fn(async () => true),
    createProposal: jest.fn(async () => undefined),
    readExternalRunOutputMapping: jest.fn(async () => null),
  }
})

const enqueueDeadlineSweepMock = jest.fn<Promise<void>, unknown[]>()
jest.mock('../lib/runtime/externalRunSweep', () => ({
  enqueueExternalRunDeadlineSweep: (...args: unknown[]) => enqueueDeadlineSweepMock(...args),
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

jest.mock('../events', () => ({
  emitAgentOrchestratorEvent: jest.fn(async () => undefined),
}))

const findOneWithDecryptionMock = jest.fn<Promise<unknown>, unknown[]>()
const findWithDecryptionMock = jest.fn<Promise<unknown[]>, unknown[]>()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

import { z } from 'zod'
import type { AwilixContainer } from 'awilix'
import { AgentRuntimeService } from '../lib/runtime/agentRuntime'
import { ExternalAgentSimulationUnavailableError } from '../lib/runtime/errors'
import { withRunContext } from '../lib/runtime/runContext'
import { registerFileAgent, getAgentEntry, type AgentRegistryEntry } from '../lib/sdk/defineAgent'
import {
  clearExternalAgentConnectorsForTests,
  registerExternalAgentConnector,
  type ExternalAgentConnector,
  type ExternalAgentConnectorStartArgs,
} from '../lib/runtime/externalConnectorRegistry'
import { SIMULATED_EXTERNAL_RUN_KIND } from '../lib/runtime/externalAgentRunner'
import { resetAgentAdmissionForTests } from '../lib/runtime/admission'
import { executeCaseRun } from '../lib/eval/evalReplayService'

const CONNECTOR_ID = 'test.voice'
const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const SCOPE = { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID }

const outcomeEnvelope = z.object({
  kind: z.literal('researcher'),
  data: z.object({ reached: z.boolean(), transcript: z.string() }),
})

/** What `evalReplayService` builds: no workflow step, tagged as a replay. */
const evalRunCtx = { ...SCOPE, userId: 'user-1', source: 'eval' as const }
/** What the Playground route (`api/agents/[id]/run`) builds: no `source` at all. */
const playgroundRunCtx = { ...SCOPE, userId: 'user-1' }
/** What the workflow bridge builds for a production INVOKE_AGENT step. */
const productionRunCtx = { ...SCOPE, userId: 'user-1', source: 'runtime' as const }

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
    description: 'External researcher agent for eval-safety tests.',
    instructions: '',
    runtime: 'external',
    connectorId: CONNECTOR_ID,
    callbackTimeoutMs: 30 * 60 * 1000,
    ...overrides,
  }
  registerFileAgent(entry)
  return entry
}

let startMock: jest.Mock<Promise<{ externalRunId: string; expectsCallback: true }>, [ExternalAgentConnectorStartArgs]>
let mockArgs: ExternalAgentConnectorStartArgs[] = []

function stubConnector(overrides: Partial<ExternalAgentConnector> = {}): ExternalAgentConnector {
  return {
    id: CONNECTOR_ID,
    start: startMock,
    verifyCallback: () => true,
    normalize: (raw) => raw,
    ...overrides,
  }
}

function makeContainer(): AwilixContainer {
  return {
    resolve(name: string) {
      if (name === 'em') return { fork: () => ({}) }
      if (name === 'openCodeClient') return {}
      throw new Error(`[internal] unexpected resolve("${name}")`)
    },
  } as unknown as AwilixContainer
}

function makeService(): AgentRuntimeService {
  return new AgentRuntimeService({ container: makeContainer(), commandBus: {} as never })
}

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

let runSeq = 0

beforeEach(() => {
  runSeq = 0
  mockArgs = []
  startMock = jest.fn(async (_args: ExternalAgentConnectorStartArgs) => ({
    externalRunId: 'conv-1',
    expectsCallback: true as const,
  }))
  clearExternalAgentConnectorsForTests()
  createRunMock.mockReset().mockImplementation(async () => `run-${++runSeq}`)
  completeRunMock.mockReset().mockResolvedValue(undefined)
  failRunMock.mockReset().mockResolvedValue(undefined)
  createExternalRunRowMock.mockReset().mockResolvedValue('external-row-1')
  enqueueDeadlineSweepMock.mockReset().mockResolvedValue(undefined)
  runAiAgentObjectMock.mockReset()
  openCodeRunMock.mockReset()
  findOneWithDecryptionMock.mockReset()
  findWithDecryptionMock.mockReset().mockResolvedValue([])
  process.env.APP_URL = 'https://app.example.com'
})

afterEach(() => {
  resetAgentAdmissionForTests()
  delete process.env.APP_URL
})

describe('an eval replay of an external agent whose connector cannot simulate', () => {
  /**
   * THE test. `connector.start` placing a call is the irreversible act, so the
   * assertion that matters is that it was never invoked — not merely that the
   * promise rejected.
   */
  it('REFUSES, and connector.start is never called', async () => {
    registerAgent('voice.eval_no_mock')
    registerExternalAgentConnector(stubConnector())

    const error = await captureRejection<ExternalAgentSimulationUnavailableError>(
      makeService().runOrSuspend('voice.eval_no_mock', { brief: 'call the owner' }, evalRunCtx),
    )

    expect(startMock).not.toHaveBeenCalled()

    expect(error).toBeInstanceOf(ExternalAgentSimulationUnavailableError)
    expect(error.code).toBe('external_agent_simulation_unavailable')
    expect(error.connectorId).toBe(CONNECTOR_ID)
    expect(error.source).toBe('eval')
    // A connector will not grow a `mock` on the second attempt, and a retry of a
    // dialling path is exactly what must never be invited.
    expect(error.retryable).toBe(false)
    expect(error.message).toContain('voice.eval_no_mock')
    expect(error.message).toContain(CONNECTOR_ID)
  })

  it('leaves nothing behind: no run row, no correlation row, no deadline job', async () => {
    registerAgent('voice.eval_no_mock_clean')
    registerExternalAgentConnector(stubConnector())

    await captureRejection(
      makeService().runOrSuspend('voice.eval_no_mock_clean', {}, evalRunCtx),
    )

    // Nothing was attempted — the same "no failed run for a run that never
    // executed" rule the ACL and configuration refusals follow.
    expect(createRunMock).not.toHaveBeenCalled()
    expect(failRunMock).not.toHaveBeenCalled()
    expect(createExternalRunRowMock).not.toHaveBeenCalled()
    expect(enqueueDeadlineSweepMock).not.toHaveBeenCalled()
  })

  /**
   * The legacy `run()` surface is the one `evalReplayService` actually calls, so
   * the refusal has to survive the suspended-outcome translation rather than being
   * visible only through `runOrSuspend`.
   */
  it('surfaces through the legacy run() surface too', async () => {
    registerAgent('voice.eval_no_mock_legacy')
    registerExternalAgentConnector(stubConnector())

    await expect(
      makeService().run('voice.eval_no_mock_legacy', {}, evalRunCtx),
    ).rejects.toBeInstanceOf(ExternalAgentSimulationUnavailableError)
    expect(startMock).not.toHaveBeenCalled()
  })

  /**
   * The backstop signal. A caller that forgets to thread `source` but runs INSIDE
   * an eval run tree — a `delegate_agent` hop, say — is still an eval replay, and
   * the ambient async-scoped origin says so.
   */
  it('refuses a delegated run that inherits the eval tag from the run context alone', async () => {
    registerAgent('voice.eval_nested')
    registerExternalAgentConnector(stubConnector())

    const error = await captureRejection<ExternalAgentSimulationUnavailableError>(
      withRunContext(
        'parent-run-1',
        () => makeService().runOrSuspend('voice.eval_nested', {}, playgroundRunCtx),
        'eval',
      ),
    )

    expect(startMock).not.toHaveBeenCalled()
    expect(error).toBeInstanceOf(ExternalAgentSimulationUnavailableError)
  })
})

describe('an eval replay of an external agent whose connector CAN simulate', () => {
  it('returns the connector\'s would-do payload, marked simulated, without dialling', async () => {
    registerAgent('voice.eval_mocked')
    registerExternalAgentConnector(
      stubConnector({
        mock: (args) => {
          mockArgs.push(args)
          return { wouldDial: '+48123456789', wouldSay: 'deal at risk' }
        },
      }),
    )

    const outcome = await makeService().runOrSuspend(
      'voice.eval_mocked',
      { brief: 'deal at risk' },
      evalRunCtx,
    )

    // Still never dialled: a simulation is the absence of the side effect, not a
    // cheaper version of it.
    expect(startMock).not.toHaveBeenCalled()
    expect(createExternalRunRowMock).not.toHaveBeenCalled()
    expect(enqueueDeadlineSweepMock).not.toHaveBeenCalled()

    expect(outcome).toEqual({
      kind: 'settled',
      result: {
        kind: 'researcher',
        data: {
          simulated: true,
          started: false,
          kind: SIMULATED_EXTERNAL_RUN_KIND,
          source: 'eval',
          agentId: 'voice.eval_mocked',
          connectorId: CONNECTOR_ID,
          wouldDo: { wouldDial: '+48123456789', wouldSay: 'deal at risk' },
        },
      },
    })

    // The run is recorded as completed with exactly that envelope, so an operator
    // reading the run — or an eval case promoted from it — sees a simulation and
    // not an answer.
    expect(completeRunMock).toHaveBeenCalledTimes(1)
    const completeInput = completeRunMock.mock.calls[0][2] as Record<string, unknown>
    expect(completeInput.runId).toBe('run-1')
    expect(completeInput.resultKind).toBe('researcher')
    expect(completeInput.output).toEqual(outcome.kind === 'settled' ? outcome.result : null)

    // The mock is handed the real agent entry and input so it can describe the call
    // faithfully — but NOT a live credential.
    expect(mockArgs).toHaveLength(1)
    expect(mockArgs[0].agentEntry.id).toBe('voice.eval_mocked')
    expect(mockArgs[0].input).toEqual({ brief: 'deal at risk' })
    expect(mockArgs[0].scope).toEqual(SCOPE)
    expect(mockArgs[0].callbackToken).not.toMatch(/^xrun_/)
    expect(mockArgs[0].callbackUrl).not.toContain('app.example.com')
  })

  /**
   * The platform must never synthesise an answer on a connector's behalf. Nesting
   * the would-do under `wouldDo` is what makes that hold even against a `mock`
   * that returns the exact shape of a real outcome: the outcome fields end up one
   * level below where any reader of a researcher result looks.
   */
  it('cannot be mistaken for a real outcome even when the mock returns outcome-shaped data', async () => {
    registerAgent('voice.eval_lying_mock')
    registerExternalAgentConnector(
      stubConnector({ mock: () => ({ reached: true, transcript: 'the owner agreed' }) }),
    )

    const outcome = await makeService().runOrSuspend('voice.eval_lying_mock', {}, evalRunCtx)
    if (outcome.kind !== 'settled' || outcome.result.kind !== 'researcher') {
      throw new Error('[internal] expected a settled researcher result')
    }
    const data = outcome.result.data as Record<string, unknown>

    expect(data.simulated).toBe(true)
    expect(data.started).toBe(false)
    // The agent's declared outcome fields are absent at the level a consumer reads.
    expect(data.reached).toBeUndefined()
    expect(data.transcript).toBeUndefined()
    expect(data.wouldDo).toEqual({ reached: true, transcript: 'the owner agreed' })
    // And the whole thing fails the agent's own outcome envelope, so nothing that
    // validates before use can consume it as an answer.
    expect(outcomeEnvelope.safeParse(outcome.result).success).toBe(false)
  })

  it('fails the run and reports the defect when the connector\'s mock throws', async () => {
    registerAgent('voice.eval_mock_throws')
    const boom = new Error('[internal] mock is broken')
    registerExternalAgentConnector(
      stubConnector({
        mock: () => {
          throw boom
        },
      }),
    )

    await expect(
      makeService().runOrSuspend('voice.eval_mock_throws', {}, evalRunCtx),
    ).rejects.toBe(boom)

    expect(startMock).not.toHaveBeenCalled()
    expect(completeRunMock).not.toHaveBeenCalled()
    expect(failRunMock).toHaveBeenCalledTimes(1)
    expect((failRunMock.mock.calls[0][2] as { errorMessage: string }).errorMessage).toContain(
      'mock is broken',
    )
  })

  it('keeps `this` bound for a connector that implements mock as a method', async () => {
    registerAgent('voice.eval_method_mock')
    class MethodConnector implements ExternalAgentConnector {
      readonly id = CONNECTOR_ID
      private readonly label = 'method-bound'
      start = startMock
      verifyCallback() {
        return true
      }
      normalize(raw: unknown) {
        return raw
      }
      mock() {
        return { via: this.label }
      }
    }
    registerExternalAgentConnector(new MethodConnector())

    const outcome = await makeService().runOrSuspend('voice.eval_method_mock', {}, evalRunCtx)
    if (outcome.kind !== 'settled' || outcome.result.kind !== 'researcher') {
      throw new Error('[internal] expected a settled researcher result')
    }
    expect((outcome.result.data as { wouldDo: unknown }).wouldDo).toEqual({ via: 'method-bound' })
  })
})

describe('production traffic is unaffected', () => {
  it('an explicit `runtime`-sourced run still dials', async () => {
    registerAgent('voice.production')
    registerExternalAgentConnector(stubConnector())

    const outcome = await makeService().runOrSuspend('voice.production', { brief: 'x' }, productionRunCtx)

    expect(startMock).toHaveBeenCalledTimes(1)
    expect(outcome).toEqual({ kind: 'suspended', runId: 'run-1', externalRunId: 'conv-1' })
    expect(createExternalRunRowMock).toHaveBeenCalledTimes(1)
    expect(enqueueDeadlineSweepMock).toHaveBeenCalledTimes(1)
    // The real path still mints a live single-use bearer and an absolute URL.
    expect(startMock.mock.calls[0][0].callbackToken).toMatch(/^xrun_[0-9a-f]{64}$/)
    expect(startMock.mock.calls[0][0].callbackUrl).toContain('https://app.example.com/')
  })

  /**
   * THE PLAYGROUND DECISION, tested at its own path. `api/agents/[id]/run`
   * builds a ctx with no `source`, so an operator clicking "Run" on a voice agent
   * places a REAL call. That is deliberate and is left alone: it is an explicit
   * human action, on a tenant that has configured provider credentials, behind BOTH
   * the `agent_orchestrator.agents.run` route feature and the default-off
   * `agent_orchestrator.external_agents.invoke` grant this runner enforces. Guarding
   * it would leave no way to smoke-test a connector end to end, which is what the
   * Playground is for — and a guard that made the Playground refuse every external
   * agent would push operators to test by triggering real workflows instead, which
   * is strictly worse.
   */
  it('a Playground run (no `source` on the ctx) still dials', async () => {
    registerAgent('voice.playground')
    registerExternalAgentConnector(stubConnector({ mock: () => ({ never: 'used' }) }))

    const outcome = await makeService().runOrSuspend('voice.playground', {}, playgroundRunCtx)

    // Even with a `mock` available, an unsourced run is production traffic and is
    // NOT silently simulated — a Playground that quietly faked its answer would be
    // worse than one that dialled.
    expect(startMock).toHaveBeenCalledTimes(1)
    expect(outcome.kind).toBe('suspended')
    expect(completeRunMock).not.toHaveBeenCalled()
  })
})

describe('other runtimes are untouched by the simulation gate', () => {
  it('a native agent replays normally under `source: eval`', async () => {
    registerAgent('eval.native', {
      runtime: 'native',
      connectorId: undefined,
      callbackTimeoutMs: undefined,
    })
    runAiAgentObjectMock.mockResolvedValue({
      mode: 'generate',
      object: { kind: 'researcher', data: { reached: true, transcript: 'x' } },
      usage: { inputTokens: 1, outputTokens: 1 },
    })

    const outcome = await makeService().runOrSuspend('eval.native', {}, evalRunCtx)

    expect(outcome).toEqual({
      kind: 'settled',
      result: { kind: 'researcher', data: { reached: true, transcript: 'x' } },
    })
    expect(runAiAgentObjectMock).toHaveBeenCalledTimes(1)
  })

  it('an opencode agent replays normally under `source: eval`', async () => {
    registerAgent('eval.opencode', {
      runtime: 'opencode',
      connectorId: undefined,
      callbackTimeoutMs: undefined,
    })
    openCodeRunMock.mockResolvedValue({ kind: 'researcher', data: { ok: true } })

    const outcome = await makeService().runOrSuspend('eval.opencode', {}, evalRunCtx)

    expect(outcome).toEqual({ kind: 'settled', result: { kind: 'researcher', data: { ok: true } } })
    expect(openCodeRunMock).toHaveBeenCalledTimes(1)
  })
})

/**
 * The link the whole task depends on, driven through the REAL replay service
 * rather than by handing the runner a ctx a test wrote: `executeCaseRun` must
 * reach `agentRuntime` still carrying `source: 'eval'`, or the guard above never
 * fires in production.
 */
describe('evalReplayService end to end', () => {
  type FakeRow = Record<string, unknown>

  function makeEvalContainer(runtime: AgentRuntimeService, caseRun: FakeRow, evalCase: FakeRow) {
    const em = {
      fork: () => em,
      findOne: async (entity: { name: string }) => {
        if (entity.name === 'AgentEvalCaseRun') return caseRun
        if (entity.name === 'AgentEvalCase') return evalCase
        return null
      },
      find: async () => [],
      persist: () => undefined,
      create: (_entity: unknown, data: FakeRow) => data,
      flush: async () => undefined,
      refresh: async () => undefined,
    }
    return {
      resolve(name: string) {
        if (name === 'em') return em
        if (name === 'agentRuntime') return runtime
        throw new Error(`[internal] unexpected resolve("${name}")`)
      },
    } as unknown as AwilixContainer
  }

  it('records the case as an error and never dials when the connector cannot simulate', async () => {
    registerAgent('voice.eval_service')
    registerExternalAgentConnector(stubConnector())

    const caseRun: FakeRow = {
      id: '44444444-4444-4444-8444-444444444444',
      suiteRunId: '55555555-5555-4555-8555-555555555555',
      evalCaseId: '66666666-6666-4666-8666-666666666666',
      trialIndex: 0,
      status: 'pending',
      passed: null,
      score: null,
    }
    const evalCase: FakeRow = {
      id: caseRun.evalCaseId,
      agentDefinitionId: 'voice.eval_service',
      input: { brief: 'call the owner' },
      expected: null,
      assertions: null,
    }
    findOneWithDecryptionMock.mockResolvedValue(evalCase)

    const runtime = new AgentRuntimeService({ container: makeContainer(), commandBus: {} as never })
    const outcome = await executeCaseRun(
      makeEvalContainer(runtime, caseRun, evalCase),
      caseRun.id as string,
      SCOPE,
      'operator-1',
    )

    // Fifty of these would have been fifty phone calls.
    expect(startMock).not.toHaveBeenCalled()
    expect(createRunMock).not.toHaveBeenCalled()

    expect(outcome.status).toBe('error')
    // The case records WHY, so an operator reading a red suite sees "this agent
    // cannot be replayed" rather than an unexplained failure.
    expect(String(caseRun.errorMessage)).toContain('voice.eval_service')
    expect(String(caseRun.errorMessage)).toContain('provides no mock')
  })
})
