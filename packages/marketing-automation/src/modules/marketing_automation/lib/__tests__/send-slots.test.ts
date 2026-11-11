import {
  expireStaleSendReservations,
  releaseSendSlot,
  reserveSendSlot,
  SEND_RESERVATION_LEASE_MINUTES,
  settleSendSlot,
} from '../send-slots'
import type { EntityManager } from '@mikro-orm/postgresql'

const scope = { tenantId: 't1', organizationId: 'o1' }
const now = new Date('2026-10-02T12:00:00.000Z')

/**
 * The frequency cap used to be check-then-send.
 *
 * Count what this subject has had, decide, then hand the message to the transport — so three workers running
 * three campaigns for the same person all read the same number and all sent, and "at most two a week"
 * delivered four. The promise that broke is the one in the preference centre, which is the worst place for it.
 */
function fakeEm(takenPerCap: number[]) {
  const executed: Array<{ sql: string; params: unknown[] }> = []
  const created: Array<Record<string, unknown>> = []
  const counts: Array<Record<string, unknown>> = []
  const updates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = []
  const deletes: Array<Record<string, unknown>> = []
  let countCall = 0

  const tx = {
    execute: async (sql: string, params: unknown[]) => { executed.push({ sql, params }); return [] },
    count: async (_entity: unknown, where: Record<string, unknown>) => {
      counts.push(where)
      return takenPerCap[countCall++] ?? 0
    },
    create: (_entity: unknown, data: Record<string, unknown>) => {
      created.push(data)
      return { id: 'slot-1', ...data }
    },
    persist: () => undefined,
    flush: async () => undefined,
  }

  const em = {
    transactional: async <T>(work: (tx: unknown) => Promise<T>) => work(tx),
    nativeUpdate: async (_entity: unknown, where: Record<string, unknown>, data: Record<string, unknown>) => {
      updates.push({ where, data })
      return 1
    },
    nativeDelete: async (_entity: unknown, where: Record<string, unknown>) => {
      deletes.push(where)
      return 1
    },
  }
  return { em: em as unknown as EntityManager, executed, created, counts, updates, deletes }
}

const input = {
  scope,
  subjectEntityId: 'cust-1',
  campaignId: 'camp-1',
  runId: 'run-1',
  stepId: 'step-1',
  channel: 'email' as const,
  caps: [
    { maxMessages: 2, windowHours: 168, reason: 'preference_cap' as const },
    { maxMessages: 3, windowHours: 24, reason: 'frequency_cap' as const },
  ],
  now,
}

describe('reserveSendSlot', () => {
  it('serialises per subject before it counts anything', async () => {
    const { em, executed, counts } = fakeEm([0, 0])
    await reserveSendSlot(em, input)
    // The lock is the whole fix: without it two workers both read a number that does not include the other.
    expect(executed[0].sql).toContain('pg_advisory_xact_lock')
    expect(String(executed[0].params[0])).toContain('cust-1')
    expect(counts.length).toBeGreaterThan(0)
  })

  it('takes a transaction lock, never a session one', async () => {
    // A session lock on a pooled connection outlives the request that took it.
    const { em, executed } = fakeEm([0, 0])
    await reserveSendSlot(em, input)
    expect(executed[0].sql).toContain('_xact_')
  })

  it('counts each cap in its own window', async () => {
    const { em, counts } = fakeEm([0, 0])
    await reserveSendSlot(em, input)
    expect(counts[0].sentAt).toEqual({ $gte: new Date(now.getTime() - 168 * 3_600_000) })
    expect(counts[1].sentAt).toEqual({ $gte: new Date(now.getTime() - 24 * 3_600_000) })
  })

  it('counts reservations as well as sends', async () => {
    // A slot another worker has taken for a message about to go out is spent, even though nothing has gone.
    const { em, counts } = fakeEm([0, 0])
    await reserveSendSlot(em, input)
    expect(counts[0].status).toEqual({ $in: ['sent', 'reserved'] })
  })

  it('writes the reservation when every cap has room, and names the slot', async () => {
    const { em, created } = fakeEm([0, 0])
    await expect(reserveSendSlot(em, input)).resolves.toEqual({ reserved: true, id: 'slot-1' })
    expect(created[0]).toMatchObject({ status: 'reserved', subjectEntityId: 'cust-1', sentAt: now })
  })

  it('refuses with the cap that refused, and writes nothing', async () => {
    const { em, created } = fakeEm([2])
    await expect(reserveSendSlot(em, input)).resolves.toEqual({ reserved: false, reason: 'preference_cap' })
    expect(created).toHaveLength(0)
  })

  it('stops at the first full cap rather than asking the rest', async () => {
    const { em, counts } = fakeEm([2, 0])
    await reserveSendSlot(em, input)
    expect(counts).toHaveLength(1)
  })
})

describe('settling and releasing', () => {
  it('only ever settles a row that is still reserved', async () => {
    // Guards against a second worker settling a slot the sweep already expired.
    const { em, updates } = fakeEm([])
    await settleSendSlot(em, scope, 'slot-1', 'sent')
    expect(updates[0].where).toMatchObject({ id: 'slot-1', status: 'reserved', ...scope })
    expect(updates[0].data).toEqual({ status: 'sent' })
  })

  it('deletes a released slot rather than marking it failed', async () => {
    // A `failed` row would tell the deliverability guardrail the transport rejected something it never saw.
    const { em, deletes } = fakeEm([])
    await releaseSendSlot(em, scope, 'slot-1')
    expect(deletes[0]).toMatchObject({ id: 'slot-1', status: 'reserved', ...scope })
  })
})

describe('expireStaleSendReservations', () => {
  it('frees slots past the lease and leaves fresher ones alone', async () => {
    const { em, deletes } = fakeEm([])
    await expireStaleSendReservations(em, scope, now)
    expect(deletes[0]).toMatchObject({ status: 'reserved', ...scope })
    expect(deletes[0].sentAt).toEqual({ $lt: new Date(now.getTime() - SEND_RESERVATION_LEASE_MINUTES * 60_000) })
  })

  it('uses the same lease as the run claim, because it answers the same question', () => {
    // How long this module waits before deciding a worker is gone.
    expect(SEND_RESERVATION_LEASE_MINUTES).toBe(15)
  })
})
