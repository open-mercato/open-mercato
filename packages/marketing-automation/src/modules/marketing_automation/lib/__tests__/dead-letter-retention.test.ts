import { DEAD_LETTER_RETENTION_DAYS, pruneDeadLetters } from '../dead-letter'
import type { EntityManager } from '@mikro-orm/postgresql'

const scope = { tenantId: 't1', organizationId: 'o1' }
const now = new Date('2026-10-02T12:00:00.000Z')

/**
 * The dead-letter table was append-only with nothing ever reading or removing a row.
 *
 * A tenant with a malformed integration accumulated one per failed delivery for ever. Pruned by the sweep
 * that writes them, which is the rule this module already follows for the job log: a cleanup task nobody
 * scheduled is a table that grows until somebody notices it.
 */
describe('pruneDeadLetters', () => {
  function fakeEm() {
    const deletes: Array<Record<string, unknown>> = []
    const em = {
      nativeDelete: async (_entity: unknown, where: Record<string, unknown>) => {
        deletes.push(where)
        return 3
      },
    }
    return { em: em as unknown as EntityManager, deletes }
  }

  test('removes rows past the window and reports how many', async () => {
    const { em, deletes } = fakeEm()
    await expect(pruneDeadLetters(em, scope, now)).resolves.toBe(3)
    const where = deletes[0] as { $and: Array<Record<string, unknown>> }
    const cutoff = (where.$and[2] as { createdAt: { $lt: Date } }).createdAt.$lt
    expect(cutoff).toEqual(new Date(now.getTime() - DEAD_LETTER_RETENTION_DAYS * 86_400_000))
  })

  test('matches the job log, so the two sides of the same question share a window', () => {
    // A reader comparing "what ran" with "what could not" should not hold two windows in their head.
    expect(DEAD_LETTER_RETENTION_DAYS).toBe(30)
  })

  /**
   * The dispatcher records a dead letter even when it could not resolve a tenant, so those rows belong to
   * nobody — and scoping the prune strictly would make them the only ones that never expire.
   */
  test('includes the rows that carry no scope', async () => {
    const { em, deletes } = fakeEm()
    await pruneDeadLetters(em, scope, now)
    expect(deletes[0]).toMatchObject({
      $and: [
        { $or: [{ tenantId: 't1' }, { tenantId: null }] },
        { $or: [{ organizationId: 'o1' }, { organizationId: null }] },
        { createdAt: { $lt: expect.any(Date) } },
      ],
    })
  })

  test('never reaches another tenant\'s rows that are in scope', async () => {
    const { em, deletes } = fakeEm()
    await pruneDeadLetters(em, scope, now)
    const serialised = JSON.stringify(deletes[0])
    expect(serialised).toContain('t1')
    expect(serialised).not.toContain('t2')
  })
})
