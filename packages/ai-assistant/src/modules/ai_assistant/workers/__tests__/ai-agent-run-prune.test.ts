import type { EntityManager } from '@mikro-orm/postgresql'
import { AiAgentRun, AiAgentRunStep, AiAgentRunToolCall } from '../../data/entities'

const mockFindWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

import { resolveAgentRunRetentionDays, runAgentRunPrune } from '../ai-agent-run-prune'

type DeleteCall = { entity: unknown; where: Record<string, unknown> }

function makeEm(batches: string[][]) {
  const deleteCalls: DeleteCall[] = []
  let batchIndex = 0
  mockFindWithDecryption.mockImplementation(async () => {
    const ids = batches[batchIndex] ?? []
    batchIndex += 1
    return ids.map((id) => ({ id }))
  })
  const em = {
    nativeDelete: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      deleteCalls.push({ entity, where })
      const filter = (where.runId ?? where.id) as { $in: string[] }
      return filter.$in.length
    }),
  } as unknown as EntityManager
  return { em, deleteCalls }
}

describe('runAgentRunPrune', () => {
  const originalRetention = process.env.AI_AGENT_RUNS_RETENTION_DAYS

  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.AI_AGENT_RUNS_RETENTION_DAYS
  })

  afterAll(() => {
    if (originalRetention === undefined) delete process.env.AI_AGENT_RUNS_RETENTION_DAYS
    else process.env.AI_AGENT_RUNS_RETENTION_DAYS = originalRetention
  })

  it('selects runs older than the cutoff or soft-deleted, in batches', async () => {
    const { em } = makeEm([])
    await runAgentRunPrune({ em, now: new Date('2026-06-30T00:00:00Z'), retentionDays: 30, batchSize: 1000 })
    expect(mockFindWithDecryption).toHaveBeenCalledTimes(1)
    const [, entity, where, options] = mockFindWithDecryption.mock.calls[0]
    expect(entity).toBe(AiAgentRun)
    expect(where).toEqual({
      $or: [
        { createdAt: { $lt: new Date('2026-05-31T00:00:00Z') } },
        { deletedAt: { $ne: null } },
      ],
    })
    expect(options).toEqual({ fields: ['id'], limit: 1000 })
  })

  it('deletes tool calls and steps before their runs', async () => {
    const { em, deleteCalls } = makeEm([['run-1', 'run-2']])
    const summary = await runAgentRunPrune({ em, now: new Date('2026-06-30T00:00:00Z'), retentionDays: 30, batchSize: 10 })
    expect(deleteCalls.map((call) => call.entity)).toEqual([AiAgentRunToolCall, AiAgentRunStep, AiAgentRun])
    expect(deleteCalls[0].where).toEqual({ runId: { $in: ['run-1', 'run-2'] } })
    expect(deleteCalls[1].where).toEqual({ runId: { $in: ['run-1', 'run-2'] } })
    expect(deleteCalls[2].where).toEqual({ id: { $in: ['run-1', 'run-2'] } })
    expect(summary).toEqual({ runsDeleted: 2, stepsDeleted: 2, toolCallsDeleted: 2 })
  })

  it('loops over full batches and stops after a partial batch', async () => {
    const { em, deleteCalls } = makeEm([['run-1', 'run-2'], ['run-3', 'run-4'], ['run-5']])
    const summary = await runAgentRunPrune({ em, now: new Date('2026-06-30T00:00:00Z'), retentionDays: 30, batchSize: 2 })
    expect(mockFindWithDecryption).toHaveBeenCalledTimes(3)
    expect(deleteCalls).toHaveLength(9)
    expect(summary.runsDeleted).toBe(5)
  })

  it('does not delete anything when no run qualifies', async () => {
    const { em, deleteCalls } = makeEm([[]])
    const summary = await runAgentRunPrune({ em, now: new Date('2026-06-30T00:00:00Z'), retentionDays: 30 })
    expect(deleteCalls).toHaveLength(0)
    expect(summary).toEqual({ runsDeleted: 0, stepsDeleted: 0, toolCallsDeleted: 0 })
  })

  it('uses the retention days from the environment', async () => {
    process.env.AI_AGENT_RUNS_RETENTION_DAYS = '7'
    const { em } = makeEm([])
    await runAgentRunPrune({ em, now: new Date('2026-06-30T00:00:00Z') })
    const [, , where] = mockFindWithDecryption.mock.calls[0]
    expect(where.$or[0]).toEqual({ createdAt: { $lt: new Date('2026-06-23T00:00:00Z') } })
  })

  it('falls back to 30 days for invalid or non-positive retention values', () => {
    expect(resolveAgentRunRetentionDays()).toBe(30)
    process.env.AI_AGENT_RUNS_RETENTION_DAYS = 'abc'
    expect(resolveAgentRunRetentionDays()).toBe(30)
    process.env.AI_AGENT_RUNS_RETENTION_DAYS = '0'
    expect(resolveAgentRunRetentionDays()).toBe(30)
    process.env.AI_AGENT_RUNS_RETENTION_DAYS = '-5'
    expect(resolveAgentRunRetentionDays()).toBe(30)
    process.env.AI_AGENT_RUNS_RETENTION_DAYS = '14'
    expect(resolveAgentRunRetentionDays()).toBe(14)
  })
})
