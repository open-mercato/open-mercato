import { UniqueConstraintViolationException } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { addScoreEntry, loadScorePoints } from '../scores'

const scope = { tenantId: 't1', organizationId: 'o1' }
const now = new Date('2026-09-28T12:00:00.000Z')

function fakeEm(options: { total?: string | null; reject?: unknown } = {}) {
  const executed: Array<{ sql: string; params: unknown[] }> = []
  const persisted: Record<string, unknown>[] = []
  let flushes = 0
  const fork = {
    create: (_entity: unknown, data: Record<string, unknown>) => ({ id: 'entry-1', ...data }),
    persist: (entity: Record<string, unknown>) => { persisted.push(entity) },
    flush: async () => {
      flushes += 1
      if (options.reject) throw options.reject
    },
  }
  const em = {
    fork: () => fork,
    getConnection: () => ({
      execute: async (sql: string, params: unknown[]) => {
        executed.push({ sql, params })
        return [{ total: options.total ?? '0' }]
      },
    }),
  }
  return { em: em as unknown as EntityManager, executed, persisted, flushes: () => flushes }
}

describe('loadScorePoints', () => {
  test('sums the ledger, scoped', async () => {
    const { em, executed } = fakeEm({ total: '40' })
    expect(await loadScorePoints(em, 'c1', scope)).toBe(40)
    expect(executed[0].params).toEqual(['c1', 't1', 'o1'])
    expect(executed[0].sql).toContain('sum(points)')
  })

  test('a customer with no entries scores zero, not null', async () => {
    const { em } = fakeEm({ total: null })
    // Zero is the right answer for a points total, and the subject document must never carry null
    // into an audience comparison.
    expect(await loadScorePoints(em, 'c1', scope)).toBe(0)
  })

  test('a negative total is preserved', async () => {
    const { em } = fakeEm({ total: '-15' })
    expect(await loadScorePoints(em, 'c1', scope)).toBe(-15)
  })
})

describe('addScoreEntry', () => {
  test('records the entry with its provenance and returns both totals', async () => {
    const { em, persisted } = fakeEm({ total: '30' })
    const result = await addScoreEntry(em, {
      scope,
      subjectEntityId: 'c1',
      points: 10,
      reason: 'opened three emails',
      source: 'campaign',
      campaignId: 'camp-1',
      runId: 'run-1',
      stepId: 'step-1',
      now,
    })
    expect(result).toEqual({ applied: true, previousPoints: 30, points: 40 })
    expect(persisted[0]).toMatchObject({
      subjectEntityId: 'c1',
      points: 10,
      reason: 'opened three emails',
      source: 'campaign',
      campaignId: 'camp-1',
      runId: 'run-1',
      stepId: 'step-1',
    })
  })

  test('a manual adjustment carries no run or step', async () => {
    const { em, persisted } = fakeEm()
    await addScoreEntry(em, { scope, subjectEntityId: 'c1', points: 5, source: 'manual', now })
    // Null rather than undefined: the partial unique index keys on run_id, and several manual
    // adjustments for one customer must all be allowed.
    expect(persisted[0].runId).toBeNull()
    expect(persisted[0].stepId).toBeNull()
    expect(persisted[0].reason).toBeNull()
  })

  // The guard firing. An increment is the one write a retry cannot repeat safely, so this is the
  // property the whole ledger design exists for.
  test('the same (run, step) awarding twice is reported as not applied, not as an error', async () => {
    const { em } = fakeEm({
      total: '40',
      reject: new UniqueConstraintViolationException(new Error('duplicate key value violates unique constraint')),
    })
    const result = await addScoreEntry(em, {
      scope, subjectEntityId: 'c1', points: 10, source: 'campaign', runId: 'run-1', stepId: 'step-1', now,
    })
    expect(result).toEqual({ applied: false, previousPoints: 40, points: 40 })
  })

  test('any other failure throws, because it is not a duplicate', async () => {
    const { em } = fakeEm({ reject: new Error('connection reset') })
    await expect(addScoreEntry(em, {
      scope, subjectEntityId: 'c1', points: 10, source: 'campaign', runId: 'r', stepId: 's', now,
    })).rejects.toThrow('connection reset')
  })

  test('deducting points lowers the reported total', async () => {
    const { em } = fakeEm({ total: '100' })
    const result = await addScoreEntry(em, {
      scope, subjectEntityId: 'c1', points: -25, source: 'campaign', runId: 'r', stepId: 's', now,
    })
    expect(result.points).toBe(75)
  })

  test('inserts through a fork, so a rejection cannot pollute the caller', async () => {
    const { em, flushes } = fakeEm({
      reject: new UniqueConstraintViolationException(new Error('duplicate key')),
    })
    await addScoreEntry(em, { scope, subjectEntityId: 'c1', points: 1, source: 'campaign', runId: 'r', stepId: 's', now })
    expect(flushes()).toBe(1)
  })
})
