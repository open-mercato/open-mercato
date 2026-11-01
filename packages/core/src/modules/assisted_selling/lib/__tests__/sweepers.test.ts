jest.mock('../../events', () => ({ emitAssistedSellingEvent: jest.fn(async () => undefined) }))

import { emitAssistedSellingEvent } from '../../events'
import {
  AssistedSellingParticipant,
  AssistedSellingProposal,
  AssistedSellingStoreSettings,
  AssistedSellingThread,
} from '../../data/entities'
import { sweepIdleThreads, sweepRetention } from '../sweepers'

const TENANT_ID = 'tenant-1'
const ORG_ID = 'org-1'
const STORE_ID = 'store-1'

type Row = Record<string, unknown>

function matchesWhere(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, condition]) => {
    const value = row[key]
    if (condition === null) return value === null || value === undefined
    if (condition && typeof condition === 'object' && '$lte' in (condition as Row)) {
      const bound = (condition as Row).$lte as Date
      return value instanceof Date && value.getTime() <= bound.getTime()
    }
    return value === condition
  })
}

function makeThreadRow(overrides: Row = {}): Row {
  return {
    id: 'thread-1',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    storeId: STORE_ID,
    status: 'open',
    lastActivityAt: new Date('2026-01-01T00:00:00.000Z'),
    closedAt: null,
    deletedAt: null,
    ...overrides,
  }
}

function makeSettingsRow(overrides: Row = {}): Row {
  return {
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    storeId: STORE_ID,
    idleCloseDays: 30,
    conversationRetentionDays: 365,
    deletedAt: null,
    ...overrides,
  }
}

function makeFakeEm(options: { threads?: Row[]; settings?: Row[]; participants?: Row[] } = {}) {
  const threads = options.threads ?? []
  const settings = options.settings ?? []
  const participants = options.participants ?? []
  const nativeUpdateCalls: Array<{ entity: unknown; where: Row; data: Row }> = []

  const em: Record<string, unknown> = {
    find: jest.fn(async (entity: unknown, where: Row, opts?: { fields?: string[] }) => {
      if (entity === AssistedSellingThread) {
        const matches = threads.filter((row) => matchesWhere(row, where))
        if (opts?.fields?.includes('storeId') && opts.fields.length === 1) {
          return matches.map((row) => ({ storeId: row.storeId }))
        }
        return matches
      }
      if (entity === AssistedSellingParticipant) return participants.filter((row) => matchesWhere(row, where))
      return []
    }),
    findOne: jest.fn(async (entity: unknown, where: Row) => {
      if (entity === AssistedSellingStoreSettings) return settings.find((row) => matchesWhere(row, where)) ?? null
      if (entity === AssistedSellingThread) return threads.find((row) => matchesWhere(row, where)) ?? null
      return null
    }),
    nativeUpdate: jest.fn(async (entity: unknown, where: Row, data: Row) => {
      nativeUpdateCalls.push({ entity, where, data })
      if (entity === AssistedSellingThread) {
        const matches = threads.filter((row) => matchesWhere(row, where))
        matches.forEach((row) => Object.assign(row, data))
        return matches.length
      }
      if (entity === AssistedSellingProposal) return 0
      return 0
    }),
    nativeDelete: jest.fn(async () => 0),
    persist: jest.fn((row: Row) => {
      // `eraseAssistedSellingThread` mutates the thread row it already has a reference to
      // (loaded via `findOne` above) and persists it — no extra bookkeeping needed here.
      void row
    }),
    flush: jest.fn(async () => undefined),
  }
  return { em, threads, settings, nativeUpdateCalls }
}

describe('sweepIdleThreads (§5.10 idle-close sweeper, S7 gap-fill)', () => {
  const now = new Date('2026-03-01T00:00:00.000Z')

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('closes an open thread past its store\'s idle_close_days and emits thread.closed', async () => {
    const thread = makeThreadRow({ lastActivityAt: new Date('2026-01-01T00:00:00.000Z') })
    const { em } = makeFakeEm({ threads: [thread], settings: [makeSettingsRow({ idleCloseDays: 30 })] })

    const result = await sweepIdleThreads(em as any, { tenantId: TENANT_ID, organizationId: ORG_ID }, now)

    expect(result.closedCount).toBe(1)
    expect(thread.status).toBe('closed')
    expect(thread.closedAt).toEqual(now)
    expect(emitAssistedSellingEvent).toHaveBeenCalledWith('assisted_selling.thread.closed', {
      threadId: 'thread-1',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      reason: 'idle',
    })
  })

  it('leaves an open thread alone when its last activity is within the idle window', async () => {
    const thread = makeThreadRow({ lastActivityAt: new Date('2026-02-28T12:00:00.000Z') })
    const { em } = makeFakeEm({ threads: [thread], settings: [makeSettingsRow({ idleCloseDays: 30 })] })

    const result = await sweepIdleThreads(em as any, { tenantId: TENANT_ID, organizationId: ORG_ID }, now)

    expect(result.closedCount).toBe(0)
    expect(thread.status).toBe('open')
    expect(emitAssistedSellingEvent).not.toHaveBeenCalled()
  })

  it('falls back to the 30-day default when the store has no settings row', async () => {
    const thread = makeThreadRow({ lastActivityAt: new Date('2026-01-01T00:00:00.000Z') })
    const { em } = makeFakeEm({ threads: [thread], settings: [] })

    const result = await sweepIdleThreads(em as any, { tenantId: TENANT_ID, organizationId: ORG_ID }, now)

    expect(result.closedCount).toBe(1)
  })

  it('is a CAS: a thread a concurrent write already moved off "open" is skipped, not reported as an error', async () => {
    // Simulates the race: the candidate matched the initial `find`'s threshold, but a
    // message landed (or another tick closed it) before this call's own `nativeUpdate`.
    const thread = makeThreadRow({ lastActivityAt: new Date('2026-01-01T00:00:00.000Z'), status: 'closed' })
    const { em } = makeFakeEm({ threads: [thread], settings: [makeSettingsRow({ idleCloseDays: 30 })] })
    // Override `find` to still surface the stale candidate (as the real DB would mid-race),
    // while `nativeUpdate`'s own `status: 'open'` WHERE clause correctly no-ops against it.
    ;(em.find as jest.Mock).mockImplementation(async (entity: unknown, where: Row, opts?: { fields?: string[] }) => {
      if (entity !== AssistedSellingThread) return []
      if (opts?.fields?.includes('storeId')) return [{ storeId: STORE_ID }]
      return [thread]
    })

    const result = await sweepIdleThreads(em as any, { tenantId: TENANT_ID, organizationId: ORG_ID }, now)

    expect(result.closedCount).toBe(0)
    expect(emitAssistedSellingEvent).not.toHaveBeenCalled()
  })

  it('sweeps multiple stores, each against its own idle_close_days', async () => {
    const threadA = makeThreadRow({ id: 'thread-a', storeId: 'store-a', lastActivityAt: new Date('2026-02-20T00:00:00.000Z') })
    const threadB = makeThreadRow({ id: 'thread-b', storeId: 'store-b', lastActivityAt: new Date('2026-02-20T00:00:00.000Z') })
    const { em } = makeFakeEm({
      threads: [threadA, threadB],
      settings: [
        makeSettingsRow({ storeId: 'store-a', idleCloseDays: 30 }),
        makeSettingsRow({ storeId: 'store-b', idleCloseDays: 3 }),
      ],
    })

    const result = await sweepIdleThreads(em as any, { tenantId: TENANT_ID, organizationId: ORG_ID }, now)

    // store-a's 30-day window has not elapsed (9 days since last activity); store-b's
    // 3-day window has — only thread-b closes.
    expect(result.closedCount).toBe(1)
    expect(threadA.status).toBe('open')
    expect(threadB.status).toBe('closed')
  })
})

describe('sweepRetention (§5.10 retention sweeper, S7 gap-fill)', () => {
  const now = new Date('2026-03-01T00:00:00.000Z')

  it('erases a closed thread past its store\'s conversation_retention_days', async () => {
    const thread = makeThreadRow({ status: 'closed', closedAt: new Date('2025-01-01T00:00:00.000Z') })
    const { em } = makeFakeEm({ threads: [thread], settings: [makeSettingsRow({ conversationRetentionDays: 365 })] })

    const result = await sweepRetention(em as any, { tenantId: TENANT_ID, organizationId: ORG_ID }, now)

    expect(result.erasedCount).toBe(1)
    expect(thread.deletedAt).toBeInstanceOf(Date)
  })

  it('leaves a closed thread alone when it is still within the retention window', async () => {
    const thread = makeThreadRow({ status: 'closed', closedAt: new Date('2026-02-01T00:00:00.000Z') })
    const { em } = makeFakeEm({ threads: [thread], settings: [makeSettingsRow({ conversationRetentionDays: 365 })] })

    const result = await sweepRetention(em as any, { tenantId: TENANT_ID, organizationId: ORG_ID }, now)

    expect(result.erasedCount).toBe(0)
    expect(thread.deletedAt).toBeNull()
  })

  it('falls back to the 365-day default when the store has no settings row', async () => {
    const thread = makeThreadRow({ status: 'closed', closedAt: new Date('2025-01-01T00:00:00.000Z') })
    const { em } = makeFakeEm({ threads: [thread], settings: [] })

    const result = await sweepRetention(em as any, { tenantId: TENANT_ID, organizationId: ORG_ID }, now)

    expect(result.erasedCount).toBe(1)
  })

  it('never touches an open thread, regardless of how stale lastActivityAt is', async () => {
    const thread = makeThreadRow({ status: 'open', lastActivityAt: new Date('2020-01-01T00:00:00.000Z') })
    const { em } = makeFakeEm({ threads: [thread], settings: [makeSettingsRow({ conversationRetentionDays: 365 })] })

    const result = await sweepRetention(em as any, { tenantId: TENANT_ID, organizationId: ORG_ID }, now)

    expect(result.erasedCount).toBe(0)
  })
})
