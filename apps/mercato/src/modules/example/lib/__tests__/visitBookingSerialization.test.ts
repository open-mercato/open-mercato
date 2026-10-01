import { createVisitBookingSerializingCommandBus } from '../visitBookingSerialization'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const ENTITY_ID = '22222222-2222-4222-8222-222222222222'
const TENANT_ID = '33333333-3333-4333-8333-333333333333'
const ORGANIZATION_ID = '44444444-4444-4444-8444-444444444444'

class AdvisoryLockManager {
  private tails = new Map<string, Promise<void>>()

  async acquire(key: string): Promise<() => void> {
    const previous = this.tails.get(key) ?? Promise.resolve()
    let releaseCurrent!: () => void
    const current = new Promise<void>((resolve) => { releaseCurrent = resolve })
    const tail = previous.then(() => current)
    this.tails.set(key, tail)
    await previous
    return () => {
      releaseCurrent()
      if (this.tails.get(key) === tail) this.tails.delete(key)
    }
  }
}

function lockingEntityManager(manager: AdvisoryLockManager, acquiredKeys: string[], statements: string[]) {
  const em = {
    fork: () => em,
    transactional: async <T>(run: (tx: typeof em) => Promise<T>) => {
      const releases: Array<() => void> = []
      const tx = {
        ...em,
        getConnection: () => ({
          execute: async (_sql: string, params: string[]) => {
            statements.push(_sql)
            acquiredKeys.push(params[0]!)
            releases.push(await manager.acquire(params[0]!))
          },
        }),
      }
      try {
        return await run(tx)
      } finally {
        releases.reverse().forEach((release) => release())
      }
    },
  }
  return em
}

function createContendingCommandBus(state: { bookings: number }) {
  return {
    execute: jest.fn(async () => {
      const available = state.bookings === 0
      await new Promise<void>((resolve) => setTimeout(resolve, 5))
      if (!available) throw new Error('example.calendar.visitAvailability.booked')
      state.bookings += 1
      return { result: { interactionId: `visit-${state.bookings}` }, logEntry: null }
    }),
  }
}

describe('Visit booking command serialization', () => {
  it('serializes two concurrent request containers so exactly one overlapping Visit wins', async () => {
    const manager = new AdvisoryLockManager()
    const acquiredKeys: string[] = []
    const statements: string[] = []
    const state = { bookings: 0 }
    const input = {
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      entityId: ENTITY_ID,
      interactionType: 'visit',
      scheduledAt: new Date('2026-10-01T09:00:00.000Z'),
      durationMinutes: 60,
      participants: [{ userId: USER_ID }],
    }
    const context = {
      auth: { tenantId: TENANT_ID },
      selectedOrganizationId: ORGANIZATION_ID,
      organizationIds: [ORGANIZATION_ID],
      organizationScope: null,
      container: {},
    }
    const first = createVisitBookingSerializingCommandBus({
      commandBus: createContendingCommandBus(state) as never,
      em: lockingEntityManager(manager, acquiredKeys, statements) as never,
      queryEngine: { query: jest.fn() } as never,
    })
    const second = createVisitBookingSerializingCommandBus({
      commandBus: createContendingCommandBus(state) as never,
      em: lockingEntityManager(manager, acquiredKeys, statements) as never,
      queryEngine: { query: jest.fn() } as never,
    })

    const outcomes = await Promise.allSettled([
      first.execute('customers.interactions.create', { input, ctx: context as never }),
      second.execute('customers.interactions.create', { input, ctx: context as never }),
    ])

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1)
    expect(state.bookings).toBe(1)
    expect(acquiredKeys).toEqual([
      `example:visit-booking:${TENANT_ID}:${ORGANIZATION_ID}:staff:${USER_ID}`,
      `example:visit-booking:${TENANT_ID}:${ORGANIZATION_ID}:staff:${USER_ID}`,
    ])
    expect(statements).toEqual([
      'select pg_advisory_xact_lock(hashtextextended(?::text, 0))',
      'select pg_advisory_xact_lock(hashtextextended(?::text, 0))',
    ])
  })
})
