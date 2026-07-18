export {}

jest.mock('../../lib/mrp/loaders', () => ({
  loadMrpInputs: jest.fn(),
}))
jest.mock('../../lib/mrp/engine', () => ({
  runMrp: jest.fn(),
}))
jest.mock('../../lib/mrp/persistSuggestions', () => ({
  persistMrpSuggestions: jest.fn(),
}))
jest.mock('../../events.js', () => ({
  emitProductionEvent: jest.fn().mockResolvedValue(undefined),
}))

import { runMrpJob } from '../../lib/mrp/runJob'
import { loadMrpInputs } from '../../lib/mrp/loaders'
import { runMrp } from '../../lib/mrp/engine'
import { persistMrpSuggestions } from '../../lib/mrp/persistSuggestions'
import { emitProductionEvent } from '../../events.js'

/**
 * Task 5.2 — `runMrpJob` (the worker's business logic), TDD `[tdd:required]`.
 *
 * DoD under test: progress is visible via `ProgressJob` (the worker's
 * `progressService` calls are asserted, not just the final `MrpRun` row),
 * and the run/job lifecycle transitions correctly on success and failure.
 */

type Row = Record<string, unknown> & { id: string }

function makeFakeEm(runRow: Row) {
  const rows: Row[] = [runRow]
  const em: any = {
    findOne: jest.fn(async (_Entity: unknown, filter: Record<string, unknown>) => {
      return rows.find((row) => row.id === filter.id) ?? null
    }),
    flush: jest.fn(async () => undefined),
    fork: jest.fn(),
  }
  em.fork.mockReturnValue(em)
  return { em, rows }
}

function makeProgressServiceMock() {
  let jobCounter = 0
  return {
    createJob: jest.fn(async (_input: unknown) => ({ id: `job-${++jobCounter}` })),
    startJob: jest.fn(async () => undefined),
    updateProgress: jest.fn(async () => undefined),
    completeJob: jest.fn(async () => undefined),
    failJob: jest.fn(async () => undefined),
  }
}

function makeContainer(em: unknown, progressService: unknown) {
  return {
    resolve: jest.fn((name: string) => {
      if (name === 'em') return em
      if (name === 'progressService') return progressService
      return undefined
    }),
  }
}

const loadMrpInputsMock = loadMrpInputs as jest.Mock
const runMrpMock = runMrp as jest.Mock
const persistMrpSuggestionsMock = persistMrpSuggestions as jest.Mock
const emitProductionEventMock = emitProductionEvent as jest.Mock

describe('runMrpJob', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('creates a ProgressJob, links it to the run, and reports progress through loading/computing/persisting', async () => {
    const runRow: Row = { id: 'run-1', tenantId: 't1', organizationId: 'o1', status: 'pending', params: { asOfDate: '2026-01-01' } }
    const { em } = makeFakeEm(runRow)
    const progressService = makeProgressServiceMock()
    const container = makeContainer(em, progressService)

    loadMrpInputsMock.mockResolvedValue({
      asOfDate: '2026-01-01',
      demands: [{ productKey: 'p1::', qty: 1, uom: 'pcs', dueDate: '2026-01-01', source: { type: 'min_stock' } }],
      bomVersionsByProductKey: {},
      planningParamsByProductKey: {},
      stockByProductKey: {},
      openSupply: [],
      unitConversionsByProductKey: {},
    })
    runMrpMock.mockReturnValue({
      suggestions: [
        {
          type: 'buy',
          productKey: 'p1::',
          productId: 'p1',
          variantId: null,
          qty: 5,
          uom: 'pcs',
          dueDate: '2026-01-05',
          pegging: [],
        },
      ],
      warnings: [],
      stats: { demandsProcessed: 1, levelsExploded: 1, elapsedMsPlaceholder: 0 },
    })
    persistMrpSuggestionsMock.mockResolvedValue({
      inserted: 1,
      openCount: 1,
      carriedCount: 0,
      supersededPriorOpenCount: 0,
    })

    const summary = await runMrpJob({ container: container as never, mrpRunId: 'run-1', tenantId: 't1', organizationId: 'o1' })

    // ProgressJob created and linked to the run (DoD: progress visible via ProgressJob)
    expect(progressService.createJob).toHaveBeenCalledTimes(1)
    expect(runRow.progressJobId).toBe('job-1')
    expect(progressService.startJob).toHaveBeenCalledWith('job-1', expect.objectContaining({ tenantId: 't1', organizationId: 'o1' }))

    // Progress reported per phase: loading (demand count), computing (suggestion count), persisting (final)
    expect(progressService.updateProgress).toHaveBeenCalledWith(
      'job-1',
      { totalCount: 1, processedCount: 0 },
      expect.anything(),
    )
    expect(progressService.updateProgress).toHaveBeenCalledWith(
      'job-1',
      { totalCount: 1, processedCount: 1 },
      expect.anything(),
    )

    expect(progressService.completeJob).toHaveBeenCalledTimes(1)
    expect(runRow.status).toBe('completed')
    expect(summary.suggestionsInserted).toBe(1)
    expect(summary.suggestionsOpen).toBe(1)

    expect(emitProductionEventMock).toHaveBeenCalledWith(
      'production.mrp_run.completed',
      expect.objectContaining({ id: 'run-1' }),
      expect.anything(),
    )
  })

  it('on engine failure, marks the run failed and calls progressService.failJob (worker updates job)', async () => {
    const runRow: Row = { id: 'run-1', tenantId: 't1', organizationId: 'o1', status: 'pending', params: { asOfDate: '2026-01-01' } }
    const { em } = makeFakeEm(runRow)
    const progressService = makeProgressServiceMock()
    const container = makeContainer(em, progressService)

    loadMrpInputsMock.mockRejectedValue(new Error('boom'))

    await expect(
      runMrpJob({ container: container as never, mrpRunId: 'run-1', tenantId: 't1', organizationId: 'o1' }),
    ).rejects.toThrow('boom')

    expect(runRow.status).toBe('failed')
    expect(progressService.failJob).toHaveBeenCalledWith(
      'job-1',
      { errorMessage: 'boom' },
      expect.anything(),
    )
    expect(progressService.completeJob).not.toHaveBeenCalled()
  })

  it('throws when the MrpRun row cannot be found for the given scope', async () => {
    const { em } = makeFakeEm({ id: 'other-run', tenantId: 't1', organizationId: 'o1', status: 'pending' })
    const progressService = makeProgressServiceMock()
    const container = makeContainer(em, progressService)

    await expect(
      runMrpJob({ container: container as never, mrpRunId: 'run-missing', tenantId: 't1', organizationId: 'o1' }),
    ).rejects.toThrow()
  })
})
