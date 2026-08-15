/** @jest-environment node */
/**
 * The retro-rounding driver: what it selects, how it reports, and what it refuses
 * to do. The command next door owns the write; this owns the job.
 */
import type { AwilixContainer } from 'awilix'

jest.mock('@open-mercato/queue', () => ({
  createModuleQueue: jest.fn(() => ({ enqueue: jest.fn(async () => 'job-1') })),
}))

import {
  REAPPLY_ROUNDING_BATCH_SIZE,
  countReapplyRoundingCandidates,
  reapplyRoundingWithProgress,
  type ReapplyRoundingScope,
} from '../reapplyRounding'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_A = '22222222-2222-4222-8222-22222222000a'
const ORG_B = '22222222-2222-4222-8222-22222222000b'
const PROGRESS_JOB_ID = '33333333-3333-4333-8333-333333333333'

type CandidateRow = { id: string; organization_id: string }

function makeWorld(rows: CandidateRow[]) {
  const execute = jest.fn(async (sql: string, params: unknown[]) => {
    if (String(sql).includes('COUNT(*)')) return [{ candidate_count: rows.length }]
    const cursor = String(sql).includes('AND id > ?') ? (params[params.length - 2] as string) : null
    const limit = params[params.length - 1] as number
    const remaining = cursor ? rows.filter((row) => row.id > cursor) : rows
    return remaining.slice(0, limit)
  })

  const commandCalls: Array<{ id: string; input: Record<string, unknown>; ctx: Record<string, unknown> }> = []
  const commandBus = {
    execute: jest.fn(async (id: string, options: { input: Record<string, unknown>; ctx: Record<string, unknown> }) => {
      commandCalls.push({ id, input: options.input, ctx: options.ctx })
      const entryIds = options.input.entryIds as string[]
      return { result: { updatedCount: entryIds.length, unchangedCount: 0, skippedCount: 0 } }
    }),
  }

  const progressService = {
    startJob: jest.fn(async () => ({})),
    updateProgress: jest.fn(async () => ({})),
    completeJob: jest.fn(async () => ({})),
    failJob: jest.fn(async () => ({})),
    markCancelled: jest.fn(async () => ({})),
    isCancellationRequested: jest.fn(async () => false),
  }

  const container = {
    resolve: (name: string) => {
      if (name === 'em') return { fork: () => ({ getConnection: () => ({ execute }) }), getConnection: () => ({ execute }) }
      if (name === 'commandBus') return commandBus
      if (name === 'progressService') return progressService
      throw new Error(`[internal] Unexpected resolve ${name}`)
    },
  } as unknown as AwilixContainer

  return { container, execute, commandBus, commandCalls, progressService }
}

function rowsFor(count: number, organizationId = ORG_A): CandidateRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `entry-${String(index).padStart(6, '0')}`,
    organization_id: organizationId,
  }))
}

const scope: ReapplyRoundingScope = { tenantId: TENANT_ID, organizationIds: [ORG_A], userId: 'user-1' }

describe('countReapplyRoundingCandidates', () => {
  it('counts only unlocked, undeleted entries of the tenant', async () => {
    const { container, execute } = makeWorld(rowsFor(3))
    const em = (container.resolve as (name: string) => { getConnection: () => { execute: jest.Mock } })('em')

    await expect(countReapplyRoundingCandidates(em as never, scope)).resolves.toBe(3)

    const [sql, params] = execute.mock.calls[0]
    expect(String(sql)).toContain('locked_report_id IS NULL')
    expect(String(sql)).toContain('deleted_at IS NULL')
    expect(String(sql)).toContain('tenant_id = ?')
    expect(String(sql)).toContain('organization_id = ANY(?)')
    expect(params[0]).toBe(TENANT_ID)
  })

  it('covers every organization when the caller is not narrowed', async () => {
    const { container, execute } = makeWorld(rowsFor(1))
    const em = (container.resolve as (name: string) => unknown)('em')

    await countReapplyRoundingCandidates(em as never, { ...scope, organizationIds: null })

    expect(String(execute.mock.calls[0][0])).not.toContain('organization_id = ANY(?)')
  })
})

describe('reapplyRoundingWithProgress', () => {
  it('runs start → total → batches → complete and returns the counts', async () => {
    const world = makeWorld(rowsFor(3))

    const summary = await reapplyRoundingWithProgress({
      container: world.container,
      progressJobId: PROGRESS_JOB_ID,
      scope,
    })

    expect(world.progressService.startJob).toHaveBeenCalledTimes(1)
    expect(world.progressService.updateProgress).toHaveBeenCalledWith(
      PROGRESS_JOB_ID,
      { totalCount: 3, processedCount: 0 },
      expect.objectContaining({ tenantId: TENANT_ID }),
    )
    expect(summary).toEqual({
      totalCount: 3,
      processedCount: 3,
      updatedCount: 3,
      unchangedCount: 0,
      skippedCount: 0,
      cancelled: false,
    })
    expect(world.progressService.completeJob).toHaveBeenCalledWith(
      PROGRESS_JOB_ID,
      { resultSummary: expect.objectContaining({ updatedCount: 3 }) },
      expect.anything(),
    )
  })

  it('drives the reapply command, never the interactive entry update', async () => {
    const world = makeWorld(rowsFor(2))

    await reapplyRoundingWithProgress({ container: world.container, progressJobId: PROGRESS_JOB_ID, scope })

    expect(world.commandCalls).toHaveLength(1)
    expect(world.commandCalls[0].id).toBe('staff.timesheets.time_entries.reapply_rounding')
    expect(world.commandCalls[0].input).toEqual({
      tenantId: TENANT_ID,
      organizationId: ORG_A,
      entryIds: ['entry-000000', 'entry-000001'],
    })
  })

  it('suppresses per-entry events and notifications so a restatement is not an alert storm', async () => {
    const world = makeWorld(rowsFor(1))

    await reapplyRoundingWithProgress({ container: world.container, progressJobId: PROGRESS_JOB_ID, scope })

    expect(world.commandCalls[0].ctx).toMatchObject({
      systemActor: true,
      bulkImport: { skipEvents: true, skipNotifications: true },
    })
  })

  it('splits a page into one command call per organization', async () => {
    const world = makeWorld([
      { id: 'entry-000000', organization_id: ORG_A },
      { id: 'entry-000001', organization_id: ORG_B },
      { id: 'entry-000002', organization_id: ORG_A },
    ])

    await reapplyRoundingWithProgress({
      container: world.container,
      progressJobId: PROGRESS_JOB_ID,
      scope: { ...scope, organizationIds: null },
    })

    expect(world.commandCalls).toHaveLength(2)
    expect(world.commandCalls.map((call) => call.input.organizationId).sort()).toEqual([ORG_A, ORG_B].sort())
  })

  it('pages beyond one batch with a stable cursor', async () => {
    const world = makeWorld(rowsFor(REAPPLY_ROUNDING_BATCH_SIZE + 5))

    const summary = await reapplyRoundingWithProgress({
      container: world.container,
      progressJobId: PROGRESS_JOB_ID,
      scope,
    })

    expect(world.commandCalls).toHaveLength(2)
    expect(world.commandCalls[0].input.entryIds).toHaveLength(REAPPLY_ROUNDING_BATCH_SIZE)
    expect(world.commandCalls[1].input.entryIds).toHaveLength(5)
    expect(summary.processedCount).toBe(REAPPLY_ROUNDING_BATCH_SIZE + 5)
  })

  it('completes without a job update or a command when nothing is eligible', async () => {
    const world = makeWorld([])

    const summary = await reapplyRoundingWithProgress({
      container: world.container,
      progressJobId: PROGRESS_JOB_ID,
      scope,
    })

    expect(summary.totalCount).toBe(0)
    expect(world.commandBus.execute).not.toHaveBeenCalled()
    expect(world.progressService.updateProgress).not.toHaveBeenCalled()
    expect(world.progressService.completeJob).toHaveBeenCalled()
  })

  it('stops between batches when cancellation is requested', async () => {
    const world = makeWorld(rowsFor(REAPPLY_ROUNDING_BATCH_SIZE + 5))
    world.progressService.isCancellationRequested.mockResolvedValueOnce(true)

    const summary = await reapplyRoundingWithProgress({
      container: world.container,
      progressJobId: PROGRESS_JOB_ID,
      scope,
    })

    expect(summary.cancelled).toBe(true)
    expect(world.commandCalls).toHaveLength(1)
    expect(world.progressService.markCancelled).toHaveBeenCalledWith(PROGRESS_JOB_ID, expect.anything())
    expect(world.progressService.completeJob).not.toHaveBeenCalled()
  })
})
