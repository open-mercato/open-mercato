import { UniqueConstraintViolationException } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRun, expireOccurrenceKeys } from '../runs'
import type { AutomationContext } from '../engine/types'

const scope = { tenantId: 't1', organizationId: 'o1' }
const context = {
  tenantId: 't1',
  organizationId: 'o1',
  eventId: 'customers.person.created',
  occurredAt: '2026-09-28T12:00:00.000Z',
  dispatchDepth: 1,
  subjectEntityId: 'c1',
  campaignId: 'camp-1',
  trigger: {},
} as AutomationContext

/**
 * A fake entity manager whose fork can be told to reject the insert.
 *
 * The point of these tests is the GUARD, so the failure has to be made to fire: without the
 * rejection path exercised, a duplicate would only be caught by a unique index nobody tested and a
 * catch clause nobody ran.
 */
function fakeEm(options: { reject?: unknown } = {}) {
  const persisted: Record<string, unknown>[] = []
  let flushes = 0
  const fork = {
    create: (_entity: unknown, data: Record<string, unknown>) => ({ id: 'run-1', ...data }),
    persist: (entity: Record<string, unknown>) => { persisted.push(entity) },
    flush: async () => {
      flushes += 1
      if (options.reject) throw options.reject
    },
  }
  const em = { fork: () => fork, flush: async () => { throw new Error('the caller EM must not be flushed') } }
  return { em: em as unknown as EntityManager, persisted, flushes: () => flushes }
}

const uniqueViolation = () =>
  new UniqueConstraintViolationException(new Error('duplicate key value violates unique constraint'))

describe('createRun', () => {
  test('persists the occurrence key with the run', async () => {
    const { em, persisted } = fakeEm()
    const run = await createRun(em, {
      campaignId: 'camp-1',
      scope,
      subjectEntityId: 'c1',
      triggerEventId: 'customers.person.created',
      context,
      occurrenceKey: 'abc123',
    })
    expect(run).not.toBeNull()
    expect(persisted[0]).toMatchObject({ occurrenceKey: 'abc123', campaignId: 'camp-1', status: 'running' })
  })

  test('a run without an occurrence key stores null rather than undefined', async () => {
    const { em, persisted } = fakeEm()
    await createRun(em, {
      campaignId: 'camp-1',
      scope,
      subjectEntityId: 'c1',
      triggerEventId: 'marketing_automation.sweep.customers',
      context,
    })
    // Null is what makes the partial unique index skip the row; undefined would be omitted from the
    // insert and take the column default, which is the same thing today and would not be if the
    // column ever gained one.
    expect(persisted[0].occurrenceKey).toBeNull()
  })

  // The guard firing: the database rejected the insert because this occurrence already has a run.
  test('a unique violation means duplicate, not failure', async () => {
    const { em } = fakeEm({ reject: uniqueViolation() })
    await expect(createRun(em, {
      campaignId: 'camp-1',
      scope,
      subjectEntityId: 'c1',
      triggerEventId: 'customers.person.created',
      context,
      occurrenceKey: 'abc123',
    })).resolves.toBeNull()
  })

  test('any other failure still throws, because it is not a duplicate', async () => {
    const { em } = fakeEm({ reject: new Error('connection reset') })
    await expect(createRun(em, {
      campaignId: 'camp-1',
      scope,
      subjectEntityId: 'c1',
      triggerEventId: 'customers.person.created',
      context,
      occurrenceKey: 'abc123',
    })).rejects.toThrow('connection reset')
  })

  // A rejected insert on the caller's own entity manager would sit in its persist stack and be
  // retried by the next unrelated flush, which is why the insert goes through a fork.
  test('inserts through a fork so a rejection cannot pollute the caller', async () => {
    const { em, flushes } = fakeEm({ reject: uniqueViolation() })
    await createRun(em, {
      campaignId: 'camp-1',
      scope,
      subjectEntityId: 'c1',
      triggerEventId: 'customers.person.created',
      context,
      occurrenceKey: 'abc123',
    })
    expect(flushes()).toBe(1)
  })
})

describe('expireOccurrenceKeys', () => {
  function updatingEm() {
    const updates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = []
    const em = {
      nativeUpdate: async (_entity: unknown, where: Record<string, unknown>, data: Record<string, unknown>) => {
        updates.push({ where, data })
        return 3
      },
    }
    return { em: em as unknown as EntityManager, updates }
  }

  test('releases event keys older than the window', async () => {
    const { em, updates } = updatingEm()
    const now = new Date('2026-09-28T12:00:00.000Z')
    expect(await expireOccurrenceKeys(em, scope, now, 6)).toBe(3)
    expect(updates[0].data).toEqual({ occurrenceKey: null })
    expect(updates[0].where).toMatchObject({ tenantId: 't1', organizationId: 'o1' })
    expect((updates[0].where.startedAt as { $lt: Date }).$lt).toEqual(new Date('2026-09-28T06:00:00.000Z'))
  })

  // A sweep claim means "we already asked this customer about order X". Releasing one would send the
  // message again, which is the opposite of what the claim is for.
  test('never releases a sweep claim', async () => {
    const { em, updates } = updatingEm()
    await expireOccurrenceKeys(em, scope, new Date(), 6)
    expect(JSON.stringify(updates[0].where)).toContain('claim:%')
  })
})
