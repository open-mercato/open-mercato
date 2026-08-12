/**
 * The DEADLINE half of the external runtime (design §5.5, risk **R2**; tracker
 * task 2.7): a phone call nobody answers must never leave a workflow parked
 * forever.
 *
 * What is load-bearing here:
 *
 * 1. **A run past its deadline is always released.** The run fails, the row says
 *    `expired` (not `failed` — nobody answered badly, nobody answered at all) and
 *    the parked step wakes down the `error` handle.
 * 2. **Cancellation can never block that.** A connector with no `cancel`, and a
 *    `cancel` that throws, both still expire cleanly — because the most likely
 *    reason the callback never came is that the provider is down, and letting its
 *    outage veto the expiry would cause the exact parked-forever state the sweep
 *    exists to prevent.
 * 3. **THE RACE, which is the important one.** A callback and the sweep can reach
 *    the same row at the same instant. Exactly one may resume the workflow: a
 *    second resume advances a live business process past a step it already left.
 *    The gate is the conditional `pending → terminal` claim, and the tests below
 *    drive both interleavings — including the one where the sweep READ the row as
 *    pending and the callback claimed it before the sweep could, which is what
 *    proves the SELECT is only an optimisation and the claim is the guarantee.
 * 4. **Tenancy.** A sweep runs per organization and must never reach another's rows.
 *
 * The claim mock below is a faithful model of the SQL the command issues —
 * `WHERE id = ? AND tenant_id = ? AND organization_id = ? AND status = 'pending'`
 * — over a shared in-memory table, so every test drives the real gate rather than
 * a stub that always says yes.
 */

jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-registry', () => ({
  loadAgentRegistry: () => Promise.reject(new Error('skip aggregator in test')),
}))
jest.mock('../generated/file-agents.generated', () => ({ fileAgentDescriptors: [] }))

type StoredRow = {
  id: string
  tenantId: string
  organizationId: string
  runId: string
  agentId: string
  connectorId: string
  externalRunId?: string | null
  processId?: string | null
  stepId?: string | null
  signalName?: string | null
  status: string
  expiresAt: Date
}

/** The whole `agent_external_runs` table, across every tenant, for one test. */
const table: StoredRow[] = []
/** Every `where` / `options` the sweep handed the data layer, for assertion. */
const findCalls: Array<{ where: Record<string, unknown>; options?: Record<string, unknown> }> = []
/** Fires after a SELECT returns — used to interleave a callback into a sweep. */
let afterFind: (() => void) | null = null

function matches(row: StoredRow, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, condition]) => {
    const value = (row as unknown as Record<string, unknown>)[key]
    if (condition && typeof condition === 'object' && '$lte' in condition) {
      const bound = (condition as { $lte: Date }).$lte
      return value instanceof Date && value.getTime() <= bound.getTime()
    }
    if (value instanceof Date && condition instanceof Date) return value.getTime() === condition.getTime()
    return value === condition
  })
}

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: async (
    _em: unknown,
    _entity: unknown,
    where: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => {
    findCalls.push({ where, options })
    let rows = table.filter((row) => matches(row, where))
    if (options?.orderBy) rows = [...rows].sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime())
    if (typeof options?.limit === 'number') rows = rows.slice(0, options.limit)
    const snapshot = rows.map((row) => ({ ...row }))
    afterFind?.()
    return snapshot
  },
}))

const completeRunMock = jest.fn<Promise<void>, unknown[]>()
const failRunMock = jest.fn<Promise<void>, unknown[]>()

/**
 * The single-shot claim, modelled exactly as the conditional UPDATE: it succeeds
 * only while the row is still `pending` AND both tenancy columns match, and it
 * mutates the shared table so a later SELECT (or a competing claim) sees the
 * transition — which is what makes the race tests real rather than scripted.
 */
const claimExternalRunRowMock = jest.fn(
  async (
    _bus: unknown,
    _ctx: unknown,
    input: { externalRunRowId: string; tenantId: string; organizationId: string; status: string },
  ) => {
    const row = table.find(
      (candidate) =>
        candidate.id === input.externalRunRowId &&
        candidate.tenantId === input.tenantId &&
        candidate.organizationId === input.organizationId &&
        candidate.status === 'pending',
    )
    if (!row) return false
    row.status = input.status
    return true
  },
)

const settleExternalRunRowMock = jest.fn(
  async (
    _bus: unknown,
    _ctx: unknown,
    input: { externalRunRowId: string; tenantId: string; organizationId: string; status: string },
  ) => {
    const row = table.find(
      (candidate) =>
        candidate.id === input.externalRunRowId &&
        candidate.tenantId === input.tenantId &&
        candidate.organizationId === input.organizationId,
    )
    if (!row) return false
    row.status = input.status
    return true
  },
)

jest.mock('../lib/runtime/persistence', () => {
  const actual = jest.requireActual('../lib/runtime/persistence')
  return {
    shapeResult: actual.shapeResult,
    claimExternalRunRow: (...args: unknown[]) =>
      claimExternalRunRowMock(args[0], args[1], args[2] as never),
    settleExternalRunRow: (...args: unknown[]) =>
      settleExternalRunRowMock(args[0], args[1], args[2] as never),
    completeRun: (...args: unknown[]) => completeRunMock(...args),
    failRun: (...args: unknown[]) => failRunMock(...args),
    // No run here declares an outputMapping (T2.11): an expiry resumes down the
    // `error` handle, which never consults one anyway.
    readExternalRunOutputMapping: async () => null,
  }
})

jest.mock('../lib/guardrails/guardrailService', () => ({
  GUARDRAIL_SET_VERSION: 'test-version',
  persistVerdict: jest.fn(async () => []),
  GuardrailService: class {
    async checkOutput() {
      return { result: 'pass', checks: [] }
    }
  },
}))

const sendSignalMock = jest.fn<Promise<void>, unknown[]>()
jest.mock('@open-mercato/core/modules/workflows/lib/signal-handler', () => ({
  sendSignal: (...args: unknown[]) => sendSignalMock(...args),
}))

const loggerErrorMock = jest.fn()
const loggerWarnMock = jest.fn()
jest.mock('@open-mercato/shared/lib/logger', () => {
  const child = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: (...args: unknown[]) => loggerWarnMock(...args),
    error: (...args: unknown[]) => loggerErrorMock(...args),
  }
  return { createLogger: () => ({ ...child, child: () => child }) }
})

const containerHolder: { container: unknown } = { container: null }
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => containerHolder.container,
}))

const enqueueMock = jest.fn<Promise<string>, unknown[]>()
jest.mock('../lib/queue', () => ({
  ...jest.requireActual('../lib/queue'),
  getAgentOrchestratorQueue: () => ({ enqueue: (...args: unknown[]) => enqueueMock(...args) }),
}))

import { z } from 'zod'
import type { AwilixContainer } from 'awilix'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { JobContext, QueuedJob } from '@open-mercato/queue'
import { WORKFLOW_ERROR_CONTEXT_KEY } from '@open-mercato/core/modules/workflows/lib/error-routing'
import {
  completeExternalRun,
  EXTERNAL_RUN_RESUME_SIGNAL,
} from '../lib/runtime/completeExternalRun'
import {
  enqueueExternalRunDeadlineSweep,
  EXTERNAL_RUN_EXPIRY_GRACE_MS,
  runExternalRunSweepJob,
} from '../lib/runtime/externalRunSweep'
import {
  clearExternalAgentConnectorsForTests,
  registerExternalAgentConnector,
  type ExternalAgentConnector,
} from '../lib/runtime/externalConnectorRegistry'
import { AGENT_ORCHESTRATOR_EXTERNAL_RUN_SWEEP_QUEUE, type ExternalRunSweepJobPayload } from '../lib/queue'
import handleSweepJob, { metadata as sweepWorkerMetadata } from '../workers/external-run-sweep'
import type { AgentRegistryEntry } from '../lib/sdk/defineAgent'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_ORGANIZATION_ID = '44444444-4444-4444-8444-444444444444'
const PROCESS_ID = '33333333-3333-4333-8333-333333333333'
const RUN_ID = '55555555-5555-4555-8555-555555555555'
const ROW_ID = '66666666-6666-4666-8666-666666666666'
const CONNECTOR_ID = 'test.voice'

const scope = { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID }

const entry: AgentRegistryEntry = {
  id: 'voice.owner_call',
  moduleId: 'voice_agents',
  resultKind: 'researcher',
  schema: z.object({
    kind: z.literal('researcher'),
    data: z.object({ reached: z.boolean(), transcript: z.string() }),
  }),
  tools: [],
  skills: [],
  subAgents: [],
  label: 'Call the business owner',
  description: 'Places an outbound voice call and reports what was said.',
  instructions: '',
  runtime: 'external',
  connectorId: CONNECTOR_ID,
  callbackTimeoutMs: 30 * 60 * 1000,
}

const validPayload = { kind: 'researcher', data: { reached: true, transcript: 'yes, ship it' } }

/** Comfortably past both the deadline and the grace window. */
function longPast(): Date {
  return new Date(Date.now() - EXTERNAL_RUN_EXPIRY_GRACE_MS - 60_000)
}

function seedRow(overrides: Partial<StoredRow> = {}): StoredRow {
  const row: StoredRow = {
    id: ROW_ID,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    runId: RUN_ID,
    agentId: entry.id,
    connectorId: CONNECTOR_ID,
    externalRunId: 'conv-1',
    processId: PROCESS_ID,
    stepId: 'call_owner',
    signalName: EXTERNAL_RUN_RESUME_SIGNAL,
    status: 'pending',
    expiresAt: longPast(),
    ...overrides,
  }
  table.push(row)
  return row
}

function makeContainer(): AwilixContainer {
  return {
    resolve(name: string) {
      if (name === 'em') return { fork: () => ({}) }
      if (name === 'commandBus') return {} as CommandBus
      throw new Error(`[internal] unexpected resolve("${name}")`)
    },
  } as unknown as AwilixContainer
}

const deps = () => ({ container: makeContainer(), commandBus: {} as CommandBus })

const cancelMock = jest.fn<Promise<void>, [string, unknown]>()

function registerConnector(overrides: Partial<ExternalAgentConnector> = {}): void {
  clearExternalAgentConnectorsForTests()
  registerExternalAgentConnector({
    id: CONNECTOR_ID,
    start: async () => ({ externalRunId: 'conv-1', expectsCallback: true }),
    verifyCallback: () => true,
    normalize: (raw) => raw,
    cancel: (externalRunId, connectorScope) => cancelMock(externalRunId, connectorScope),
    ...overrides,
  })
}

/** The periodic per-organization tick, run through the real worker. */
async function runPeriodicTick(
  tickScope: { tenantId: string; organizationId: string } = scope,
): Promise<void> {
  const payload: ExternalRunSweepJobPayload = { scope: tickScope }
  await handleSweepJob(
    { payload } as unknown as QueuedJob<ExternalRunSweepJobPayload>,
    {} as JobContext,
  )
}

/** The targeted delayed job the runner enqueued for one specific row. */
async function runTargetedJob(
  externalRunRowId = ROW_ID,
  jobScope: { tenantId: string; organizationId: string } = scope,
): Promise<void> {
  await runExternalRunSweepJob(deps(), { externalRunRowId, scope: jobScope })
}

/** The options of the Nth `sendSignal` delivery, typed for assertion. */
function signalOptions(call = 0): {
  instanceId: string
  signalName: string
  agentOutcome: string
  payload: Record<string, unknown>
} {
  return sendSignalMock.mock.calls[call][2] as ReturnType<typeof signalOptions>
}

beforeEach(() => {
  table.length = 0
  findCalls.length = 0
  afterFind = null
  containerHolder.container = makeContainer()
  completeRunMock.mockReset().mockResolvedValue(undefined)
  failRunMock.mockReset().mockResolvedValue(undefined)
  claimExternalRunRowMock.mockClear()
  settleExternalRunRowMock.mockClear()
  sendSignalMock.mockReset().mockResolvedValue(undefined)
  cancelMock.mockReset().mockResolvedValue(undefined)
  loggerErrorMock.mockReset()
  loggerWarnMock.mockReset()
  enqueueMock.mockReset().mockResolvedValue('job-1')
  registerConnector()
})

afterAll(() => {
  clearExternalAgentConnectorsForTests()
})

describe('a run whose deadline passed with no callback', () => {
  it('cancels the external work, fails the run, marks the row expired and wakes the step down the ERROR handle', async () => {
    const row = seedRow()

    await runPeriodicTick()

    // The workflow is free: one resume, down `error`, carrying the engine's own
    // error-context key so the author's declared error route is what runs.
    expect(sendSignalMock).toHaveBeenCalledTimes(1)
    expect(signalOptions().instanceId).toBe(PROCESS_ID)
    expect(signalOptions().signalName).toBe(EXTERNAL_RUN_RESUME_SIGNAL)
    expect(signalOptions().agentOutcome).toBe('error')
    expect(signalOptions().payload).toHaveProperty(WORKFLOW_ERROR_CONTEXT_KEY)

    // The run is failed, never completed — we obtained no answer.
    expect(failRunMock).toHaveBeenCalledTimes(1)
    expect((failRunMock.mock.calls[0][2] as { runId: string }).runId).toBe(RUN_ID)
    expect(completeRunMock).not.toHaveBeenCalled()

    // The row says `expired`, not `failed`: nobody answered at all, which is a
    // different operational fact from somebody answering badly.
    expect(row.status).toBe('expired')
    expect((claimExternalRunRowMock.mock.calls[0][2] as { status: string }).status).toBe('expired')
    const settleInput = settleExternalRunRowMock.mock.calls[0][2] as Record<string, unknown>
    expect(settleInput.status).toBe('expired')
    expect(String(settleInput.failureReason)).toContain('deadline_expired')

    // The provider is hung up on, with the run's own provider id and scope.
    expect(cancelMock).toHaveBeenCalledTimes(1)
    expect(cancelMock).toHaveBeenCalledWith('conv-1', scope)
  })

  it('expires through the targeted delayed job as well as the periodic tick', async () => {
    const row = seedRow()

    await runTargetedJob()

    expect(row.status).toBe('expired')
    expect(failRunMock).toHaveBeenCalledTimes(1)
    expect(sendSignalMock).toHaveBeenCalledTimes(1)
    expect(signalOptions().agentOutcome).toBe('error')
  })

  it('never selects the encrypted columns while sweeping', async () => {
    seedRow()
    await runPeriodicTick()

    const fields = findCalls[0].options?.fields as string[]
    expect(fields).toBeDefined()
    for (const encrypted of ['requestPayload', 'resultPayload', 'failureReason']) {
      expect(fields).not.toContain(encrypted)
    }
  })

  it('leaves a run alone while its deadline is still in the future', async () => {
    const row = seedRow({ expiresAt: new Date(Date.now() + 60_000) })

    await runPeriodicTick()
    await runTargetedJob()

    expect(row.status).toBe('pending')
    expect(failRunMock).not.toHaveBeenCalled()
    expect(sendSignalMock).not.toHaveBeenCalled()
    expect(cancelMock).not.toHaveBeenCalled()
  })
})

describe('a run that is no longer pending', () => {
  it('does nothing at all — no second failRun, no second resume, no cancel', async () => {
    const row = seedRow({ status: 'completed' })

    await runPeriodicTick()
    await runTargetedJob()

    expect(row.status).toBe('completed')
    expect(failRunMock).not.toHaveBeenCalled()
    expect(completeRunMock).not.toHaveBeenCalled()
    expect(sendSignalMock).not.toHaveBeenCalled()
    expect(cancelMock).not.toHaveBeenCalled()
    // The periodic arm never even selected it; the targeted arm's status filter
    // means it never reached the claim.
    expect(claimExternalRunRowMock).not.toHaveBeenCalled()
  })

  it('is idempotent under at-least-once delivery: the same job twice resumes once', async () => {
    seedRow()

    await runTargetedJob()
    await runTargetedJob()
    await runPeriodicTick()

    expect(sendSignalMock).toHaveBeenCalledTimes(1)
    expect(failRunMock).toHaveBeenCalledTimes(1)
    expect(cancelMock).toHaveBeenCalledTimes(1)
  })
})

describe('the race between a callback and the sweep', () => {
  it('CALLBACK WINS: the sweep claims nothing and does NOT resume a second time', async () => {
    const row = seedRow()

    // The provider answers first: the row leaves `pending` as `completed` and the
    // step is woken down `researcher`.
    const settled = await completeExternalRun({
      container: makeContainer(),
      commandBus: {} as CommandBus,
      entry,
      row: { ...row, processId: PROCESS_ID, stepId: 'call_owner' },
      scope,
      settlement: { kind: 'result', payload: validPayload },
    })
    expect(settled.status).toBe('completed')
    expect(sendSignalMock).toHaveBeenCalledTimes(1)
    expect(signalOptions().agentOutcome).toBe('researcher')

    await runPeriodicTick()
    await runTargetedJob()

    // The single most important assertion in this file: the workflow advanced
    // exactly once. A second resume would push a live business process past a
    // step it had already left.
    expect(sendSignalMock).toHaveBeenCalledTimes(1)
    expect(failRunMock).not.toHaveBeenCalled()
    expect(row.status).toBe('completed')
    // And the provider is NOT hung up on — it already answered.
    expect(cancelMock).not.toHaveBeenCalled()
  })

  it('CALLBACK WINS MID-SWEEP: the sweep read the row as pending, then lost the claim', async () => {
    const row = seedRow()

    // The interleaving the status filter cannot cover: the SELECT sees `pending`,
    // and the callback claims the row before the sweep reaches its own claim. This
    // is what proves the conditional UPDATE — not the SELECT — is the gate.
    afterFind = () => {
      afterFind = null
      row.status = 'completed'
    }

    await runTargetedJob()

    expect(claimExternalRunRowMock).toHaveBeenCalledTimes(1)
    expect(await claimExternalRunRowMock.mock.results[0].value).toBe(false)
    expect(failRunMock).not.toHaveBeenCalled()
    expect(sendSignalMock).not.toHaveBeenCalled()
    expect(cancelMock).not.toHaveBeenCalled()
    expect(row.status).toBe('completed')
  })

  it('SWEEP WINS: a callback arriving afterwards reports already_settled and resumes nothing', async () => {
    const row = seedRow()

    await runPeriodicTick()
    expect(sendSignalMock).toHaveBeenCalledTimes(1)
    expect(signalOptions().agentOutcome).toBe('error')
    expect(row.status).toBe('expired')

    // The provider finally calls back with a genuine, correctly signed answer.
    const late = await completeExternalRun({
      container: makeContainer(),
      commandBus: {} as CommandBus,
      entry,
      row: { ...row, processId: PROCESS_ID, stepId: 'call_owner' },
      scope,
      settlement: { kind: 'result', payload: validPayload },
    })

    // 200 with nothing done: the workflow already took the error route, and
    // recording the late answer would falsify the row's `expired` status.
    expect(late).toEqual({ status: 'already_settled', runId: RUN_ID })
    expect(sendSignalMock).toHaveBeenCalledTimes(1)
    expect(completeRunMock).not.toHaveBeenCalled()
    expect(row.status).toBe('expired')
  })
})

describe('cancellation is best-effort and never blocks the expiry', () => {
  it('expires cleanly when the connector implements no cancel at all', async () => {
    registerConnector({ cancel: undefined })
    const row = seedRow()

    await runPeriodicTick()

    expect(row.status).toBe('expired')
    expect(failRunMock).toHaveBeenCalledTimes(1)
    expect(sendSignalMock).toHaveBeenCalledTimes(1)
    expect(signalOptions().agentOutcome).toBe('error')
  })

  it('expires cleanly when cancel THROWS, and says so loudly', async () => {
    cancelMock.mockRejectedValue(new Error('provider unreachable'))
    const row = seedRow()

    await runPeriodicTick()

    // The whole point: a provider being down is the most likely reason we are
    // here, so it must not also be able to keep the workflow parked.
    expect(row.status).toBe('expired')
    expect(failRunMock).toHaveBeenCalledTimes(1)
    expect(sendSignalMock).toHaveBeenCalledTimes(1)

    // A failed hang-up may mean a call is still live and now unattributed, which
    // is worth an error line rather than a shrug.
    const cancelErrors = loggerErrorMock.mock.calls.filter((call) =>
      String(call[0]).includes('failed to cancel'),
    )
    expect(cancelErrors).toHaveLength(1)
    expect(cancelErrors[0][1]).toMatchObject({ runId: RUN_ID, externalRunId: 'conv-1' })
  })

  it('expires cleanly when the row carries no provider id to cancel', async () => {
    const row = seedRow({ externalRunId: null })

    await runPeriodicTick()

    expect(row.status).toBe('expired')
    expect(cancelMock).not.toHaveBeenCalled()
    expect(sendSignalMock).toHaveBeenCalledTimes(1)
  })
})

describe('a run with no workflow behind it', () => {
  it('fails the run and resumes nothing', async () => {
    const row = seedRow({ processId: null, stepId: null, signalName: null })

    await runPeriodicTick()

    expect(row.status).toBe('expired')
    expect(failRunMock).toHaveBeenCalledTimes(1)
    expect(sendSignalMock).not.toHaveBeenCalled()
    // The external work is still cancelled — a synchronous or playground run that
    // never came back is still a call worth hanging up.
    expect(cancelMock).toHaveBeenCalledTimes(1)
  })
})

describe('tenancy', () => {
  it('never touches another organization\'s expired row', async () => {
    const ours = seedRow()
    const theirs = seedRow({
      id: '77777777-7777-4777-8777-777777777777',
      organizationId: OTHER_ORGANIZATION_ID,
      runId: '88888888-8888-4888-8888-888888888888',
    })

    await runPeriodicTick()

    expect(ours.status).toBe('expired')
    expect(theirs.status).toBe('pending')
    expect(failRunMock).toHaveBeenCalledTimes(1)
    expect((failRunMock.mock.calls[0][2] as { runId: string }).runId).toBe(RUN_ID)
    // The scoping is in the query, not in a post-filter.
    expect(findCalls[0].where).toMatchObject({
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      status: 'pending',
    })
  })

  it('resolves nothing when a targeted job names a row outside its own scope', async () => {
    const theirs = seedRow({ organizationId: OTHER_ORGANIZATION_ID })

    await runTargetedJob(theirs.id, scope)

    expect(theirs.status).toBe('pending')
    expect(claimExternalRunRowMock).not.toHaveBeenCalled()
    expect(failRunMock).not.toHaveBeenCalled()
    expect(sendSignalMock).not.toHaveBeenCalled()
  })

  it('ignores a job carrying no tenancy at all', async () => {
    seedRow()

    await runExternalRunSweepJob(deps(), {} as ExternalRunSweepJobPayload)

    expect(findCalls).toHaveLength(0)
    expect(sendSignalMock).not.toHaveBeenCalled()
  })
})

describe('the delayed job the runner enqueues', () => {
  it('is delayed to the deadline plus the grace window', async () => {
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000)

    await enqueueExternalRunDeadlineSweep({
      externalRunRowId: ROW_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      runId: RUN_ID,
      expiresAt,
    })

    expect(enqueueMock).toHaveBeenCalledTimes(1)
    expect(enqueueMock.mock.calls[0][0]).toEqual({ externalRunRowId: ROW_ID, scope })
    const delayMs = (enqueueMock.mock.calls[0][1] as { delayMs: number }).delayMs
    expect(delayMs).toBeGreaterThan(30 * 60 * 1000)
    expect(delayMs).toBeLessThanOrEqual(30 * 60 * 1000 + EXTERNAL_RUN_EXPIRY_GRACE_MS)
  })

  it('swallows an enqueue failure — the call is already live — and says the sweep is now the only backstop', async () => {
    enqueueMock.mockRejectedValue(new Error('redis is down'))

    await expect(
      enqueueExternalRunDeadlineSweep({
        externalRunRowId: ROW_ID,
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
        runId: RUN_ID,
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).resolves.toBeUndefined()

    expect(
      loggerErrorMock.mock.calls.filter((call) => String(call[0]).includes('deadline job')),
    ).toHaveLength(1)
  })
})

describe('worker registration', () => {
  it('declares the queue as a literal that matches the exported constant', () => {
    // The literal is required: the generator's AST extractor resolves identifiers
    // only against declarations in the same file, so an imported queue name would
    // silently drop this worker from `modules.generated.ts` — and the deadline
    // would then never be enforced anywhere.
    expect(sweepWorkerMetadata.queue).toBe(AGENT_ORCHESTRATOR_EXTERNAL_RUN_SWEEP_QUEUE)
    expect(sweepWorkerMetadata.id).toBe('agent_orchestrator:external-run-sweep')
  })
})
