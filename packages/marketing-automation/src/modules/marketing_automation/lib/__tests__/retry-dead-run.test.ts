import type { EntityManager } from '@mikro-orm/postgresql'
import { retryDeadRun } from '../runs'

/**
 * Reviving a dead run, and the two things that make it safe.
 *
 * `failRun` deliberately keeps a dead run — "a customer stuck mid-journey" stays visible — and until now nothing
 * could unstick them: the row was a gravestone. The retry is the person the dead-letter argument defers to,
 * finally given a button.
 */
const scope = { tenantId: 't1', organizationId: 'o1' }
const now = new Date('2026-10-02T12:00:00.000Z')

function fakeEm(changed: number) {
  const updates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = []
  const em = {
    nativeUpdate: async (_entity: unknown, where: Record<string, unknown>, data: Record<string, unknown>) => {
      updates.push({ where, data })
      return changed
    },
  }
  return { em: em as unknown as EntityManager, updates }
}

describe('retryDeadRun', () => {
  it('only ever touches a run that is DEAD', async () => {
    /**
     * The condition is the whole concurrency story. Two operators pressing the button together, or one pressing
     * it on a stale list, must produce one revival — and the route turns the losing call into a 409 rather than
     * telling somebody something happened that did not.
     */
    const { em, updates } = fakeEm(1)
    await retryDeadRun(em, scope, 'run-1', now)
    expect(updates[0].where).toMatchObject({ id: 'run-1', status: 'dead', tenantId: 't1', organizationId: 'o1' })
  })

  it('reports whether THIS call was the one that revived it', async () => {
    expect(await retryDeadRun(fakeEm(1).em, scope, 'run-1', now)).toBe(true)
    // Nothing matched: already revived by somebody else, or never dead.
    expect(await retryDeadRun(fakeEm(0).em, scope, 'run-1', now)).toBe(false)
  })

  it('resets the attempt budget rather than continuing it', async () => {
    /**
     * The point of requiring a person is that they have read `lastError` and dealt with the cause. Handing the
     * retry one attempt before it dies again would make the button a formality.
     */
    const { em, updates } = fakeEm(1)
    await retryDeadRun(em, scope, 'run-1', now)
    expect(updates[0].data.attempts).toBe(0)
  })

  it('puts it where the resume scan looks, and leaves no stale claim', async () => {
    const { em, updates } = fakeEm(1)
    await retryDeadRun(em, scope, 'run-1', now)
    // The scan claims `waiting` rows whose `resumeAt` is due; a leftover claim token would strand it again.
    expect(updates[0].data).toMatchObject({ status: 'waiting', resumeAt: now, claimToken: null, claimedAt: null })
  })

  it('keeps the error that explains why it died', async () => {
    // The operator may want it after the retry as much as before, and nothing else records it.
    const { em, updates } = fakeEm(1)
    await retryDeadRun(em, scope, 'run-1', now)
    expect(Object.keys(updates[0].data)).not.toContain('lastError')
  })
})
