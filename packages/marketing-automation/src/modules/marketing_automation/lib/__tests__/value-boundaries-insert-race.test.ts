import { UniqueConstraintViolationException } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { refreshValueBoundaries } from '../value-boundaries'
import { resetCapabilityCache } from '../capabilities'

/**
 * Two overlapping sweep ticks for the same scope can both read `existing: null` from the
 * check-then-insert and both reach the insert — only one can win
 * `mkt_value_boundaries_scope_uq`. The loser must fall back to an update rather than let the
 * real `UniqueConstraintViolationException` escape unhandled, the same shape
 * `recordSurveyAsked`/`addScoreEntry` already guard elsewhere in this module.
 */
const scope = { tenantId: 't1', organizationId: 'o1' }
const now = new Date('2026-10-02T12:00:00.000Z')

function fakeEm(options: { insertRejects?: boolean } = {}) {
  const updates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = []
  let flushCalls = 0
  const fork = {
    create: (_entity: unknown, data: Record<string, unknown>) => data,
    persist: () => undefined,
    flush: async () => {
      flushCalls += 1
      if (options.insertRejects) {
        throw new UniqueConstraintViolationException(new Error('duplicate key value violates unique constraint'))
      }
    },
    nativeUpdate: async (_entity: unknown, where: Record<string, unknown>, data: Record<string, unknown>) => {
      updates.push({ where, data })
      return 1
    },
  }
  const em: Record<string, unknown> = {
    findOne: async () => null,
    execute: async () => [{ sales: true, catalog: true }],
    getConnection: () => ({ execute: async () => [{}] }),
    fork: () => fork,
  }
  return { em: em as unknown as EntityManager, updates, flushCalls: () => flushCalls }
}

describe('refreshValueBoundaries insert race', () => {
  beforeEach(() => resetCapabilityCache())

  it('falls back to an update when a concurrent tick already inserted the row', async () => {
    const { em, updates } = fakeEm({ insertRejects: true })
    const result = await refreshValueBoundaries(em, scope, now)
    expect(updates).toHaveLength(1)
    expect(updates[0].where).toMatchObject(scope)
    expect(updates[0].data).toMatchObject({ computedAt: now })
    expect(result.computedAt).toBe(now.toISOString())
  })

  it('a genuine insert still just inserts, with no fallback update', async () => {
    const { em, updates, flushCalls } = fakeEm()
    await refreshValueBoundaries(em, scope, now)
    expect(flushCalls()).toBe(1)
    expect(updates).toHaveLength(0)
  })

  it('a non-collision failure still propagates', async () => {
    const em = {
      findOne: async () => null,
      execute: async () => [{ sales: true, catalog: true }],
      getConnection: () => ({ execute: async () => [{}] }),
      fork: () => ({
        create: () => ({}),
        persist: () => undefined,
        flush: async () => { throw new Error('connection reset') },
      }),
    } as unknown as EntityManager
    await expect(refreshValueBoundaries(em, scope, now)).rejects.toThrow('connection reset')
  })
})
