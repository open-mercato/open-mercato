const isOrganizationInTenant = jest.fn(async () => true)
const loadXraySettings = jest.fn(async () => ({ kAnonymity: 10 }))
const confirmSimulationSamples = jest.fn(async (_container: unknown, _em: unknown, _scope: unknown, _user: unknown, _check: unknown, groups: unknown) => groups)
const loadSimulationRunForWorker = jest.fn()
const updateActiveSimulationRun = jest.fn()

jest.mock('../../projection/payloads', () => ({ isOrganizationInTenant: (...args: unknown[]) => isOrganizationInTenant(...(args as [])) }))
jest.mock('../../projection/settings', () => ({ loadXraySettings: (...args: unknown[]) => loadXraySettings(...(args as [])) }))
jest.mock('../samples', () => ({ confirmSimulationSamples: (...args: unknown[]) => confirmSimulationSamples(...(args as [unknown, unknown, unknown, unknown, unknown, unknown])) }))
jest.mock('../store', () => {
  const actual = jest.requireActual('../store')
  return {
    ...actual,
    loadSimulationRunForWorker: (...args: unknown[]) => loadSimulationRunForWorker(...args),
    updateActiveSimulationRun: (...args: unknown[]) => updateActiveSimulationRun(...args),
  }
})

import { z } from 'zod'
import type { SimulationRunContext, SimulationSliceResult } from '@open-mercato/shared/modules/insights/simulate'
import { registerSimulateConfigEntries, resetSimulationRegistryForTests } from '../registry'
import { runSimulationSlice, type ReadOnlySliceResult } from '../jobs'
import { SIMULATION_CONTINUATION_DELAY_MS, SIMULATION_TENANT_BUSY_DELAY_MS } from '../constants'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const USER = '33333333-3333-4333-8333-333333333333'
const RUN_ID = '44444444-4444-4444-8444-444444444444'
const JOB_ID = '55555555-5555-4555-8555-555555555555'
const ARTIFACT_ID = '66666666-6666-4666-8666-666666666666'
const PAYLOAD = { runId: RUN_ID, tenantId: TENANT, organizationId: ORG }
const NOW = 1_800_000_000_000

type KindRun = (input: unknown, ctx: SimulationRunContext<unknown>) => Promise<SimulationSliceResult<unknown>>

let kindRun: jest.Mock<ReturnType<KindRun>, Parameters<KindRun>>

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    tenantId: TENANT,
    organizationId: ORG,
    kind: 'test_module.backtest',
    status: 'running',
    progressJobId: JOB_ID,
    requestedByUserId: USER,
    inputJson: { id: 'proposal' },
    artifactId: ARTIFACT_ID,
    windowFrom: new Date('2026-07-01T00:00:00Z'),
    windowTo: new Date('2026-10-01T00:00:00Z'),
    budgetsJson: { maxRecords: 50_000, maxDurationMs: 120_000, maxBatchBytes: 1000, maxBatchRows: 100, recordsUsed: 10, elapsedMs: 20_000, slices: 1 },
    resultJson: { partial: { cursor: 'c1' } },
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    ...overrides,
  }
}

function makeProgress() {
  return {
    isCancellationRequested: jest.fn(async () => false),
    startJob: jest.fn(async () => ({})),
    updateProgress: jest.fn(async () => ({})),
    completeJob: jest.fn(async () => ({})),
    failJob: jest.fn(async () => ({})),
    markCancelled: jest.fn(async () => ({})),
    touchJobHeartbeat: jest.fn(async () => undefined),
  }
}

function makeContainer(progress: ReturnType<typeof makeProgress>, granted: (features: string[]) => boolean = () => true) {
  const rbac = { userHasAllFeatures: jest.fn(async (_userId: string, features: string[]) => granted(features)) }
  const em = { fork: () => em }
  const services: Record<string, unknown> = { em, progressService: progress, rbacService: rbac }
  return {
    rbac,
    container: {
      resolve: (name: string) => {
        if (!(name in services)) throw new Error(`missing ${name}`)
        return services[name]
      },
    },
  }
}

const acquired = async <T>(_em: unknown, _tenantId: string, run: (trx: never) => Promise<T>): Promise<ReadOnlySliceResult<T>> => ({ acquired: true, value: await run({ getKysely: () => ({}) } as never) })

function deps(overrides: Record<string, unknown> = {}) {
  return { now: () => NOW, enqueue: jest.fn(async () => undefined), runSlice: acquired, ...overrides }
}

beforeEach(() => {
  jest.clearAllMocks()
  resetSimulationRegistryForTests()
  kindRun = jest.fn()
  registerSimulateConfigEntries([{
    moduleId: 'test_module',
    config: {
      version: 1,
      kinds: [{
        kind: 'test_module.backtest',
        artifactKind: 'test_module.thing',
        labelKey: 'test_module.label',
        requiredFeatures: ['test_module.view'],
        inputSchema: z.object({ id: z.string() }),
        version: 1,
        cellKeys: ['fires', 'does_not_fire'],
        readArtifactVersion: async () => null,
        fingerprintProposal: () => 'fp',
        inputFeatures: () => ['test_module.records.view'],
        run: (input: unknown, ctx: SimulationRunContext<unknown>) => kindRun(input, ctx),
      }],
      eventAdapters: [{
        eventId: 'test_module.thing.updated',
        logResourceKinds: ['test_module.thing'],
        actionTypes: ['edit'],
        requiredFeatures: ['test_module.things.view'],
        payloadFrom: () => ({ payload: { id: 'x', title: 'secret' }, valuePaths: ['title'] }),
      }],
    },
  }])
  isOrganizationInTenant.mockResolvedValue(true)
  updateActiveSimulationRun.mockImplementation(async (_em: unknown, _scope: unknown, _id: string, _expected: unknown, patch: Record<string, unknown>) => makeRun({ ...patch, updatedAt: new Date('2026-10-01T00:00:01Z') }))
})

describe('runSimulationSlice', () => {
  it('drops a job whose organization does not belong to its tenant', async () => {
    const progress = makeProgress()
    isOrganizationInTenant.mockResolvedValue(false)
    await expect(runSimulationSlice(makeContainer(progress).container, PAYLOAD, deps())).resolves.toBe('scope_mismatch')
    expect(loadSimulationRunForWorker).not.toHaveBeenCalled()
  })

  it('ignores missing and terminal runs', async () => {
    const progress = makeProgress()
    loadSimulationRunForWorker.mockResolvedValueOnce(null)
    await expect(runSimulationSlice(makeContainer(progress).container, PAYLOAD, deps())).resolves.toBe('missing')
    loadSimulationRunForWorker.mockResolvedValueOnce(makeRun({ status: 'completed' }))
    await expect(runSimulationSlice(makeContainer(progress).container, PAYLOAD, deps())).resolves.toBe('terminal')
    expect(updateActiveSimulationRun).not.toHaveBeenCalled()
  })

  it('cancels with forbidden when the requester lost a feature (re-checked before every slice)', async () => {
    const progress = makeProgress()
    loadSimulationRunForWorker.mockResolvedValue(makeRun())
    const { container, rbac } = makeContainer(progress, (features) => !features.includes('test_module.view'))
    await expect(runSimulationSlice(container, PAYLOAD, deps())).resolves.toBe('forbidden')
    expect(rbac.userHasAllFeatures).toHaveBeenCalledWith(USER, ['insights.simulator.run', 'test_module.records.view', 'test_module.view'], { tenantId: TENANT, organizationId: ORG })
    expect(updateActiveSimulationRun).toHaveBeenCalledWith(expect.anything(), { tenantId: TENANT, organizationId: ORG }, RUN_ID, null, expect.objectContaining({ status: 'cancelled', errorCode: 'forbidden', resultJson: null }), NOW)
    expect(progress.markCancelled).toHaveBeenCalledWith(JOB_ID, { tenantId: TENANT, organizationId: ORG, userId: USER })
    expect(kindRun).not.toHaveBeenCalled()
  })

  it('cancels with forbidden when the requester lost a feature the proposal needs', async () => {
    const progress = makeProgress()
    loadSimulationRunForWorker.mockResolvedValue(makeRun())
    const { container } = makeContainer(progress, (features) => !features.includes('test_module.records.view'))
    await expect(runSimulationSlice(container, PAYLOAD, deps())).resolves.toBe('forbidden')
    expect(kindRun).not.toHaveBeenCalled()
  })

  it('treats a cancelled progress job as authoritative', async () => {
    const progress = makeProgress()
    progress.isCancellationRequested.mockResolvedValue(true)
    loadSimulationRunForWorker.mockResolvedValue(makeRun())
    await expect(runSimulationSlice(makeContainer(progress).container, PAYLOAD, deps())).resolves.toBe('cancelled')
    expect(updateActiveSimulationRun).toHaveBeenCalledWith(expect.anything(), expect.anything(), RUN_ID, null, expect.objectContaining({ status: 'cancelled', errorCode: null }), NOW)
    expect(progress.markCancelled).toHaveBeenCalled()
    expect(kindRun).not.toHaveBeenCalled()
  })

  it('fails a run whose kind is no longer registered', async () => {
    const progress = makeProgress()
    loadSimulationRunForWorker.mockResolvedValue(makeRun({ kind: 'gone_module.kind' }))
    await expect(runSimulationSlice(makeContainer(progress).container, PAYLOAD, deps())).resolves.toBe('kind_unavailable')
    expect(progress.failJob).toHaveBeenCalledWith(JOB_ID, { errorMessage: 'kind_unavailable' }, expect.anything())
  })

  it('never runs an inline kind in the worker: such a run is failed as kind_unavailable', async () => {
    registerSimulateConfigEntries([{
      moduleId: 'inline_module',
      config: {
        version: 1,
        kinds: [{
          kind: 'inline_module.preview',
          artifactKind: 'inline_module.thing',
          labelKey: 'inline_module.label',
          requiredFeatures: ['inline_module.view'],
          inputSchema: z.object({ id: z.string() }),
          version: 1,
          cellKeys: ['gains'],
          execution: 'inline',
          readArtifactVersion: async () => null,
          fingerprintProposal: () => 'fp',
          run: (input: unknown, ctx: SimulationRunContext<unknown>) => kindRun(input, ctx),
        }],
      },
    }])
    const progress = makeProgress()
    loadSimulationRunForWorker.mockResolvedValue(makeRun({ kind: 'inline_module.preview' }))
    await expect(runSimulationSlice(makeContainer(progress).container, PAYLOAD, deps())).resolves.toBe('kind_unavailable')
    expect(kindRun).not.toHaveBeenCalled()
    expect(updateActiveSimulationRun).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), null, expect.objectContaining({ status: 'failed', errorCode: 'kind_unavailable' }), expect.anything())
  })

  it('requeues a slice while another slice of the tenant holds the lock', async () => {
    const progress = makeProgress()
    loadSimulationRunForWorker.mockResolvedValue(makeRun())
    const enqueue = jest.fn(async () => undefined)
    await expect(runSimulationSlice(makeContainer(progress).container, PAYLOAD, deps({ enqueue, runSlice: async () => ({ acquired: false }) }))).resolves.toBe('busy')
    expect(enqueue).toHaveBeenCalledWith(PAYLOAD, SIMULATION_TENANT_BUSY_DELAY_MS)
    expect(progress.touchJobHeartbeat).toHaveBeenCalled()
    expect(updateActiveSimulationRun).not.toHaveBeenCalled()
  })

  it('gives the kind a bounded, privacy-filtered context and persists a continuation', async () => {
    const progress = makeProgress()
    loadSimulationRunForWorker.mockResolvedValue(makeRun())
    kindRun.mockImplementation(async (_input, ctx) => {
      expect(ctx.state).toEqual({ cursor: 'c1' })
      expect(ctx.artifactId).toBe(ARTIFACT_ID)
      expect(ctx.requesterUserId).toBe(USER)
      expect(ctx.budget).toEqual({ recordsRemaining: 49_990, sliceDeadlineAt: NOW + 15_000, runDeadlineAt: NOW + 100_000, maxBatchRows: 100, maxBatchBytes: 1000 })
      expect(ctx.window).toEqual({ from: new Date('2026-07-01T00:00:00Z'), to: new Date('2026-10-01T00:00:00Z') })
      expect(ctx.eventAdapters[0].payloadFrom({} as never, { scope: ctx.scope })).toEqual({ payload: { id: 'x' }, unknownPaths: ['title'], valuePaths: [] })
      return { status: 'continue', state: { cursor: 'c2' }, recordsProcessed: 40, progress: 0.42 }
    })
    const enqueue = jest.fn(async () => undefined)
    const { container } = makeContainer(progress, (features) => !features.includes('audit_logs.view_tenant'))
    await expect(runSimulationSlice(container, PAYLOAD, deps({ enqueue }))).resolves.toBe('continued')
    expect(updateActiveSimulationRun).toHaveBeenCalledWith(expect.anything(), expect.anything(), RUN_ID, new Date('2026-10-01T00:00:00Z'), {
      resultJson: { partial: { cursor: 'c2' } },
      budgetsJson: expect.objectContaining({ recordsUsed: 50, elapsedMs: 20_000, slices: 2 }),
    }, NOW)
    expect(progress.updateProgress).toHaveBeenCalledWith(JOB_ID, { progressPercent: 42 }, expect.anything())
    expect(enqueue).toHaveBeenCalledWith(PAYLOAD, SIMULATION_CONTINUATION_DELAY_MS)
  })

  it('starts a queued run before its first slice and drops the slice when another writer won', async () => {
    const progress = makeProgress()
    loadSimulationRunForWorker.mockResolvedValue(makeRun({ status: 'queued', resultJson: null }))
    updateActiveSimulationRun.mockResolvedValueOnce(null)
    await expect(runSimulationSlice(makeContainer(progress).container, PAYLOAD, deps())).resolves.toBe('superseded')
    expect(updateActiveSimulationRun).toHaveBeenCalledWith(expect.anything(), expect.anything(), RUN_ID, new Date('2026-10-01T00:00:00Z'), { status: 'running', startedAt: new Date(NOW) }, NOW)
    expect(kindRun).not.toHaveBeenCalled()
  })

  it('completes with a k-suppressed result, confirmed samples and a ProgressJob without result data', async () => {
    const progress = makeProgress()
    loadSimulationRunForWorker.mockResolvedValue(makeRun())
    kindRun.mockResolvedValue({
      status: 'done',
      recordsProcessed: 5,
      result: {
        groups: [
          { key: 'test_module.thing.updated', sampleResourceKind: 'test_module.thing', cells: [{ key: 'fires', count: 4, sampleIds: ['a'] }, { key: 'does_not_fire', count: 40, sampleIds: ['b'] }], dataWarnings: ['neverFires'] },
          { key: 'test_module.thing.created', cells: [{ key: 'fires', count: 3 }] },
        ],
        coverage: { observed_rows: 12, 'Bad Key': 3, negative: -1 },
        caveats: ['test_module.caveat', 'not a key!'],
        fidelity: 'observed',
        truncated: true,
      },
    })
    await expect(runSimulationSlice(makeContainer(progress).container, PAYLOAD, deps())).resolves.toBe('completed')
    const patch = updateActiveSimulationRun.mock.calls.at(-1)?.[4] as Record<string, unknown>
    expect(patch).toEqual(expect.objectContaining({ status: 'completed', errorCode: null, fidelity: 'observed', coverageJson: {}, caveats: ['test_module.caveat', 'insights.simulation.caveats.coverageHidden'] }))
    const stored = patch.resultJson as { k: number; truncated: boolean; groups: Array<{ key: string; total: number | null; cells: Array<{ key: string; count: number | null; suppressed: string | null; sampleIds: string[] }> }> }
    expect(stored.k).toBe(10)
    expect(stored.truncated).toBe(true)
    expect(stored.groups[0].cells).toEqual([
      { key: 'fires', count: null, suppressed: 'below_k', sampleIds: [] },
      { key: 'does_not_fire', count: null, suppressed: 'complementary', sampleIds: [] },
    ])
    expect(stored.groups[1]).toEqual(expect.objectContaining({ total: null, suppressed: true }))
    expect(confirmSimulationSamples).toHaveBeenCalled()
    expect(progress.updateProgress).toHaveBeenCalledWith(JOB_ID, { progressPercent: 100 }, expect.anything())
    expect(progress.completeJob).toHaveBeenCalledWith(JOB_ID, undefined, expect.anything())
  })

  it('keeps the sanitized coverage when no group is suppressed', async () => {
    loadSimulationRunForWorker.mockResolvedValue(makeRun())
    kindRun.mockResolvedValue({
      status: 'done',
      recordsProcessed: 30,
      result: {
        groups: [{ key: 'test_module.thing.updated', cells: [{ key: 'fires', count: 0 }, { key: 'does_not_fire', count: 30 }] }],
        coverage: { observed_rows: 30, 'Bad Key': 3 },
        caveats: ['test_module.caveat'],
        fidelity: 'observed',
        truncated: false,
        summary: { warnings: ['test_module.warning'], counts: { pages_lost: 1 }, lists: { features_lost: ['a.b', 'not valid!'] } },
      },
    })
    await expect(runSimulationSlice(makeContainer(makeProgress()).container, PAYLOAD, deps())).resolves.toBe('completed')
    const patch = updateActiveSimulationRun.mock.calls.at(-1)?.[4] as Record<string, unknown>
    expect(patch).toEqual(expect.objectContaining({ coverageJson: { observed_rows: 30 }, caveats: ['test_module.caveat'] }))
    expect((patch.resultJson as { summary?: unknown }).summary).toEqual({ warnings: ['test_module.warning'], counts: { pages_lost: 1 }, lists: { features_lost: ['a.b'] } })
  })

  it('lets the queue retry when the RBAC service fails instead of cancelling the run as forbidden', async () => {
    loadSimulationRunForWorker.mockResolvedValue(makeRun())
    const { container, rbac } = makeContainer(makeProgress())
    rbac.userHasAllFeatures.mockRejectedValueOnce(new Error('rbac cache down'))
    await expect(runSimulationSlice(container, PAYLOAD, deps())).rejects.toThrow('[internal] The simulation feature check failed')
    expect(updateActiveSimulationRun).not.toHaveBeenCalled()
    expect(kindRun).not.toHaveBeenCalled()
  })

  it('fails with an error code only when the kind throws', async () => {
    const progress = makeProgress()
    loadSimulationRunForWorker.mockResolvedValue(makeRun())
    kindRun.mockRejectedValue(Object.assign(new Error('canceling statement due to statement timeout: value secret'), { code: '57014' }))
    await expect(runSimulationSlice(makeContainer(progress).container, PAYLOAD, deps())).resolves.toBe('failed')
    expect(updateActiveSimulationRun).toHaveBeenCalledWith(expect.anything(), expect.anything(), RUN_ID, null, expect.objectContaining({ status: 'failed', errorCode: 'statement_timeout' }), NOW)
    expect(progress.failJob).toHaveBeenCalledWith(JOB_ID, { errorMessage: 'statement_timeout' }, expect.anything())
  })

  it('fails a run past the slice cap instead of looping', async () => {
    const progress = makeProgress()
    loadSimulationRunForWorker.mockResolvedValue(makeRun({ budgetsJson: { slices: 200 } }))
    await expect(runSimulationSlice(makeContainer(progress).container, PAYLOAD, deps())).resolves.toBe('failed')
    expect(kindRun).not.toHaveBeenCalled()
  })
})
