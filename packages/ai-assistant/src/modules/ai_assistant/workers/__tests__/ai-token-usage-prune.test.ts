import { runTokenUsagePrune } from '../ai-token-usage-prune'
import type { EntityManager } from '@mikro-orm/postgresql'

type ExecuteResult = { affectedRows?: number; rowCount?: number }
type ConnectionExecuteSpy = jest.Mock<Promise<unknown[]> | Promise<ExecuteResult>>

interface ConnectionStub {
  execute: ConnectionExecuteSpy
}

function makeEmStub(connectionStub: ConnectionStub) {
  return {
    getConnection: () => connectionStub,
  } as unknown as EntityManager
}

function makeConnectionStub(options: {
  deleteBatches?: number[]
  dailyRows?: Array<Record<string, unknown>>
}): ConnectionStub {
  const { deleteBatches = [], dailyRows = [] } = options
  let deleteCallIndex = 0

  const execute: ConnectionExecuteSpy = jest.fn(async (sql: string) => {
    const normalized = sql.replace(/\s+/g, ' ').trim()

    if (normalized.includes('delete from ai_token_usage_events')) {
      const affected = deleteBatches[deleteCallIndex] ?? 0
      deleteCallIndex++
      return { affectedRows: affected }
    }

    if (normalized.includes('from ai_token_usage_daily')) {
      return dailyRows
    }

    if (normalized.includes('update ai_token_usage_daily')) {
      return [] as unknown[]
    }

    return [] as unknown[]
  })

  return { execute }
}

describe('runTokenUsagePrune', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns zero counts when there are no events or daily rows', async () => {
    const connection = makeConnectionStub({ deleteBatches: [0], dailyRows: [] })
    const em = makeEmStub(connection)
    const summary = await runTokenUsagePrune({ em, now: new Date('2026-06-01T00:00:00Z'), retentionDays: 90 })
    expect(summary.eventsDeleted).toBe(0)
    expect(summary.dailyRowsReconciled).toBe(0)
  })

  it('deletes a single partial batch and stops looping', async () => {
    const connection = makeConnectionStub({ deleteBatches: [42], dailyRows: [] })
    const em = makeEmStub(connection)
    const summary = await runTokenUsagePrune({ em, now: new Date('2026-06-01'), retentionDays: 90, batchSize: 5000 })
    expect(summary.eventsDeleted).toBe(42)
    const deleteCalls = (connection.execute as jest.Mock).mock.calls.filter(([sql]: [string]) =>
      sql.includes('delete from ai_token_usage_events'),
    )
    expect(deleteCalls).toHaveLength(1)
  })

  it('loops until a partial batch completes multi-batch pruning', async () => {
    const connection = makeConnectionStub({ deleteBatches: [100, 100, 50], dailyRows: [] })
    const em = makeEmStub(connection)
    const summary = await runTokenUsagePrune({ em, now: new Date('2026-06-01'), retentionDays: 90, batchSize: 100 })
    expect(summary.eventsDeleted).toBe(250)
    const deleteCalls = (connection.execute as jest.Mock).mock.calls.filter(([sql]: [string]) =>
      sql.includes('delete from ai_token_usage_events'),
    )
    expect(deleteCalls).toHaveLength(3)
  })

  it('reconciles daily rows that are returned by the select', async () => {
    const dailyRows = [
      { id: 'row-1', computed_session_count: '3', computed_turn_count: '4' },
      { id: 'row-2', computed_session_count: 7, computed_turn_count: 11 },
    ]
    const connection = makeConnectionStub({ deleteBatches: [0], dailyRows })
    const em = makeEmStub(connection)
    const summary = await runTokenUsagePrune({ em, now: new Date('2026-06-01'), retentionDays: 90 })
    expect(summary.dailyRowsReconciled).toBe(2)
    const updateCalls = (connection.execute as jest.Mock).mock.calls.filter(([sql]: [string]) =>
      sql.includes('update ai_token_usage_daily'),
    )
    expect(updateCalls).toHaveLength(2)
    // Each update MUST pass session_count + turn_count + id
    const firstParams = updateCalls[0][1] as unknown[]
    expect(firstParams[0]).toBe(3)
    expect(firstParams[1]).toBe(4)
    expect(firstParams[2]).toBe('row-1')
  })

  it('does not throw when the delete query fails — returns zero deleted', async () => {
    const badConnection: ConnectionStub = {
      execute: jest.fn(async (sql: string) => {
        if (sql.includes('delete from ai_token_usage_events')) {
          throw new Error('DB connection error')
        }
        return []
      }) as unknown as ConnectionExecuteSpy,
    }
    const em = makeEmStub(badConnection)
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const summary = await runTokenUsagePrune({ em, now: new Date('2026-06-01'), retentionDays: 90 })
    expect(summary.eventsDeleted).toBe(0)
    consoleSpy.mockRestore()
  })

  it('does not throw when the reconcile query fails — returns zero reconciled', async () => {
    const badConnection: ConnectionStub = {
      execute: jest.fn(async (sql: string) => {
        if (sql.includes('delete from ai_token_usage_events')) {
          return [{ affectedRows: 0 }]
        }
        throw new Error('Reconcile error')
      }) as unknown as ConnectionExecuteSpy,
    }
    const em = makeEmStub(badConnection)
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const summary = await runTokenUsagePrune({ em, now: new Date('2026-06-01'), retentionDays: 90 })
    expect(summary.dailyRowsReconciled).toBe(0)
    consoleSpy.mockRestore()
  })

  it('uses AI_TOKEN_USAGE_EVENTS_RETENTION_DAYS env var when retentionDays is not supplied', async () => {
    const original = process.env.AI_TOKEN_USAGE_EVENTS_RETENTION_DAYS
    process.env.AI_TOKEN_USAGE_EVENTS_RETENTION_DAYS = '30'
    const connection = makeConnectionStub({ deleteBatches: [0], dailyRows: [] })
    const em = makeEmStub(connection)
    await runTokenUsagePrune({ em, now: new Date('2026-06-01') })
    const deleteCall = (connection.execute as jest.Mock).mock.calls.find(([sql]: [string]) =>
      sql.includes('delete from ai_token_usage_events'),
    )
    expect(deleteCall).toBeDefined()
    const cutoffParam = deleteCall![1][0] as Date
    const cutoffIso = cutoffParam.toISOString().slice(0, 10)
    expect(cutoffIso).toBe('2026-05-02')
    process.env.AI_TOKEN_USAGE_EVENTS_RETENTION_DAYS = original
  })
})
