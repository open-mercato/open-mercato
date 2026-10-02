import { CommandBus, commandRegistry, registerCommand } from '@open-mercato/shared/lib/commands'
import { registerCommandInterceptors } from '@open-mercato/shared/lib/commands/command-interceptor-store'
import { createVisitBookingSerializingCommandBus } from '../visitBookingSerialization'

const mockEvaluateVisitAvailability = jest.fn()
const mockQuery = jest.fn()

jest.mock('../visitAvailability', () => {
  const actual = jest.requireActual('../visitAvailability')
  return {
    ...actual,
    evaluateVisitAvailability: (...args: unknown[]) => mockEvaluateVisitAvailability(...args),
  }
})

jest.mock('@open-mercato/shared/security/enabledModulesRegistry', () => ({
  getEnabledModuleIds: jest.fn(() => ['customers', 'example', 'staff', 'resources', 'planner']),
  hasEnabledModulesRegistry: jest.fn(() => true),
}))

jest.mock('@open-mercato/shared/lib/query/engine', () => ({
  BasicQueryEngine: class {
    query(...args: unknown[]) {
      return mockQuery(...args)
    }
  },
}))

const VISIT_BEHAVIOR = {
  schemaVersion: 1 as const,
  baseKind: 'event' as const,
  selectable: true,
  order: 450,
  fields: {
    endTime: true,
    allDay: false,
    recurrence: false,
    location: 'location' as const,
    people: 'recipients' as const,
    priority: false,
    resources: true as const,
  },
  customFieldsetIds: [],
}

function visitContainer() {
  return {
    resolve: (token: string) => {
      if (token === 'calendarEventTypeCatalogService') {
        return { resolveBehavior: async () => VISIT_BEHAVIOR }
      }
      return undefined
    },
  }
}

const USER_ID = '11111111-1111-4111-8111-111111111111'
const MODIFIED_USER_ID = '55555555-5555-4555-8555-555555555555'
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
  let inTransaction = false
  let releases: Array<() => void> = []
  const em = {
    fork: jest.fn(() => em),
    isInTransaction: () => inTransaction,
    begin: async () => {
      if (inTransaction) throw new Error('Nested transaction')
      inTransaction = true
    },
    execute: async (_sql: string, params: string[]) => {
      if (!inTransaction) throw new Error('Lock query executed outside a transaction')
      statements.push(_sql)
      acquiredKeys.push(params[0]!)
      releases.push(await manager.acquire(params[0]!))
    },
    getConnection: () => {
      throw new Error('Bare connection must not execute transaction-scoped locks')
    },
    commit: async () => {
      if (!inTransaction) throw new Error('Missing transaction')
      inTransaction = false
      releases.reverse().forEach((release) => release())
      releases = []
    },
    rollback: async () => {
      inTransaction = false
      releases.reverse().forEach((release) => release())
      releases = []
    },
  }
  return em
}

function createContendingCommandBus(state: { bookings: number }, transactionContexts: unknown[], sideEffectStates: boolean[]) {
  return {
    execute: jest.fn(async (_commandId: string, options: { ctx: { transactionalEm?: unknown; beforeTransactionalWrite?: (em: never) => Promise<void> } }) => {
      transactionContexts.push(options.ctx.transactionalEm)
      const transactionEm = options.ctx.transactionalEm as {
        begin: () => Promise<void>
        commit: () => Promise<void>
        rollback: () => Promise<void>
        isInTransaction: () => boolean
      }
      await transactionEm.begin()
      try {
        await options.ctx.beforeTransactionalWrite?.(transactionEm as never)
        expect(transactionEm.isInTransaction()).toBe(true)
        await new Promise<void>((resolve) => setTimeout(resolve, 5))
        state.bookings += 1
        await transactionEm.commit()
      } catch (error) {
        await transactionEm.rollback()
        throw error
      }
      sideEffectStates.push(transactionEm.isInTransaction())
      return { result: { interactionId: `visit-${state.bookings}` }, logEntry: null }
    }),
  }
}

describe('Visit booking command serialization', () => {
  afterEach(() => {
    commandRegistry.unregister('customers.interactions.create')
    registerCommandInterceptors([])
    jest.clearAllMocks()
  })

  it('serializes two concurrent request containers so exactly one overlapping Visit wins', async () => {
    const manager = new AdvisoryLockManager()
    const acquiredKeys: string[] = []
    const statements: string[] = []
    const transactionContexts: unknown[] = []
    const sideEffectStates: boolean[] = []
    const state = { bookings: 0 }
    mockEvaluateVisitAvailability.mockImplementation(async ({ input }: {
      input: { staffUserIds: string[]; resourceIds: string[] }
    }) => [
      ...input.staffUserIds.map((id) => ({
        type: 'staff',
        id,
        status: state.bookings > 0 ? 'unavailable' : 'available',
        reasonKey: state.bookings > 0 ? 'example.calendar.visitAvailability.booked' : null,
      })),
      ...input.resourceIds.map((id) => ({
        type: 'resource',
        id,
        status: state.bookings > 0 ? 'unavailable' : 'available',
        reasonKey: state.bookings > 0 ? 'example.calendar.visitAvailability.booked' : null,
      })),
    ])
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
      auth: { sub: USER_ID, tenantId: TENANT_ID },
      selectedOrganizationId: ORGANIZATION_ID,
      organizationIds: [ORGANIZATION_ID],
      organizationScope: null,
      container: visitContainer(),
    }
    const first = createVisitBookingSerializingCommandBus({
      commandBus: createContendingCommandBus(state, transactionContexts, sideEffectStates) as never,
      em: lockingEntityManager(manager, acquiredKeys, statements) as never,
    })
    const second = createVisitBookingSerializingCommandBus({
      commandBus: createContendingCommandBus(state, transactionContexts, sideEffectStates) as never,
      em: lockingEntityManager(manager, acquiredKeys, statements) as never,
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
    expect(transactionContexts).toHaveLength(2)
    expect(transactionContexts[0]).not.toBe(transactionContexts[1])
    expect((transactionContexts[0] as { fork: jest.Mock }).fork).not.toHaveBeenCalled()
    expect((transactionContexts[1] as { fork: jest.Mock }).fork).not.toHaveBeenCalled()
    expect(sideEffectStates).toEqual([false])
  })

  it('rejects planner-unavailable final input from the real modifier interceptor pipeline without a booking conflict', async () => {
    const manager = new AdvisoryLockManager()
    const acquiredKeys: string[] = []
    const statements: string[] = []
    const handlerInputs: Array<Record<string, unknown>> = []
    const persistedInputs: Array<Record<string, unknown>> = []
    const transactionEm = lockingEntityManager(manager, acquiredKeys, statements)
    registerCommand({
      id: 'customers.interactions.create',
      execute: async (input: Record<string, unknown>, ctx) => {
        handlerInputs.push(input)
        const writeEm = ctx.transactionalEm as typeof transactionEm
        await writeEm.begin()
        try {
          await ctx.beforeTransactionalWrite?.(writeEm as never, input)
          persistedInputs.push(input)
          await writeEm.commit()
        } catch (error) {
          await writeEm.rollback()
          throw error
        }
        return { interactionId: 'visit-modified' }
      },
    })
    const modifiedScheduledAt = new Date('2026-10-01T14:30:00.000Z')
    registerCommandInterceptors([{
      moduleId: 'test-modifier',
      interceptors: [{
        id: 'test.modify-visit-booking',
        targetCommand: 'customers.interactions.create',
        priority: 90,
        async beforeExecute() {
          return {
            ok: true,
            modifiedInput: {
              scheduledAt: modifiedScheduledAt,
              durationMinutes: 30,
              participants: [{ userId: MODIFIED_USER_ID }],
            },
          }
        },
      }],
    }])
    mockEvaluateVisitAvailability.mockImplementation(async ({ input }: {
      input: { startAt: string; endAt: string; staffUserIds: string[] }
    }) => {
      expect(input).toEqual(expect.objectContaining({
        startAt: '2026-10-01T14:30:00.000Z',
        endAt: '2026-10-01T15:00:00.000Z',
        staffUserIds: [MODIFIED_USER_ID],
      }))
      return [{
        type: 'staff',
        id: MODIFIED_USER_ID,
        status: 'unavailable',
        reasonKey: 'example.calendar.visitAvailability.unavailable',
      }]
    })
    const bus = createVisitBookingSerializingCommandBus({
      commandBus: new CommandBus(),
      em: transactionEm as never,
    })
    const input = {
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      entityId: ENTITY_ID,
      interactionType: 'visit',
      scheduledAt: new Date('2026-10-01T09:00:00.000Z'),
      durationMinutes: 60,
      participants: [{ userId: USER_ID }],
    }

    await expect(bus.execute('customers.interactions.create', {
      input,
      ctx: {
        auth: { sub: USER_ID, tenantId: TENANT_ID, orgId: ORGANIZATION_ID },
        selectedOrganizationId: ORGANIZATION_ID,
        organizationIds: [ORGANIZATION_ID],
        organizationScope: null,
        container: visitContainer(),
      } as never,
    })).rejects.toMatchObject({
      status: 422,
      body: { code: 'visit_availability_unavailable' },
    })

    expect(handlerInputs).toEqual([expect.objectContaining({
      scheduledAt: modifiedScheduledAt,
      durationMinutes: 30,
      participants: [{ userId: MODIFIED_USER_ID }],
    })])
    expect(persistedInputs).toEqual([])
    expect(acquiredKeys).toEqual([
      `example:visit-booking:${TENANT_ID}:${ORGANIZATION_ID}:staff:${MODIFIED_USER_ID}`,
    ])
    expect(mockEvaluateVisitAvailability).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: USER_ID,
      scope: { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      input: expect.objectContaining({ staffUserIds: [MODIFIED_USER_ID] }),
      queryEngine: expect.anything(),
    }))
  })

  describe('update path', () => {
    const INTERACTION_ID = '66666666-6666-4666-8666-666666666666'

    function storedVisit(overrides: Record<string, unknown> = {}) {
      return {
        id: INTERACTION_ID,
        tenant_id: TENANT_ID,
        organization_id: ORGANIZATION_ID,
        interaction_type: 'visit',
        status: 'planned',
        scheduled_at: '2026-10-01T09:00:00.000Z',
        duration_minutes: 60,
        participants: [{ userId: USER_ID }],
        linked_entities: [],
        all_day: false,
        recurrence_rule: null,
        owner_user_id: null,
        updated_at: '2026-09-30T09:00:00.000Z',
        ...overrides,
      }
    }

    function updateContext() {
      return {
        auth: { sub: USER_ID, tenantId: TENANT_ID, orgId: ORGANIZATION_ID },
        selectedOrganizationId: ORGANIZATION_ID,
        organizationIds: [ORGANIZATION_ID],
        organizationScope: null,
        container: visitContainer(),
      }
    }

    afterEach(() => {
      commandRegistry.unregister('customers.interactions.update')
    })

    it('re-checks a reschedule that never resends interactionType, so one of two concurrent writers loses', async () => {
      const manager = new AdvisoryLockManager()
      const acquiredKeys: string[] = []
      const statements: string[] = []
      const state = { bookings: 0 }
      mockQuery.mockImplementation(async () => ({ items: [storedVisit()], total: 1 }))
      mockEvaluateVisitAvailability.mockImplementation(async ({ input }: { input: { staffUserIds: string[] } }) =>
        input.staffUserIds.map((id) => ({
          type: 'staff',
          id,
          status: state.bookings > 0 ? 'unavailable' : 'available',
          reasonKey: state.bookings > 0 ? 'example.calendar.visitAvailability.booked' : null,
        })))
      const input = { id: INTERACTION_ID, scheduledAt: new Date('2026-10-01T11:00:00.000Z'), durationMinutes: 30 }
      const first = createVisitBookingSerializingCommandBus({
        commandBus: createContendingCommandBus(state, [], []) as never,
        em: lockingEntityManager(manager, acquiredKeys, statements) as never,
      })
      const second = createVisitBookingSerializingCommandBus({
        commandBus: createContendingCommandBus(state, [], []) as never,
        em: lockingEntityManager(manager, acquiredKeys, statements) as never,
      })

      const outcomes = await Promise.allSettled([
        first.execute('customers.interactions.update', { input, ctx: updateContext() as never }),
        second.execute('customers.interactions.update', { input, ctx: updateContext() as never }),
      ])

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
      expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1)
      expect(state.bookings).toBe(1)
      expect(mockEvaluateVisitAvailability).toHaveBeenCalledTimes(2)
      // Attempt order across the two request containers is scheduler-dependent;
      // what matters is that each writer took both the record and the subject lock.
      expect(acquiredKeys.filter((key) => key === `example:visit-booking:${TENANT_ID}:interaction:${INTERACTION_ID}`)).toHaveLength(2)
      expect(acquiredKeys.filter((key) => key === `example:visit-booking:${TENANT_ID}:${ORGANIZATION_ID}:staff:${USER_ID}`)).toHaveLength(2)
      expect(acquiredKeys).toHaveLength(4)
    })

    it('re-checks a reactivation that only flips status back to planned', async () => {
      const manager = new AdvisoryLockManager()
      mockQuery.mockImplementation(async () => ({ items: [storedVisit({ status: 'canceled' })], total: 1 }))
      mockEvaluateVisitAvailability.mockResolvedValue([
        { type: 'staff', id: USER_ID, status: 'unavailable', reasonKey: 'example.calendar.visitAvailability.booked' },
      ])
      const bus = createVisitBookingSerializingCommandBus({
        commandBus: createContendingCommandBus({ bookings: 0 }, [], []) as never,
        em: lockingEntityManager(manager, [], []) as never,
      })
      await expect(bus.execute('customers.interactions.update', {
        input: { id: INTERACTION_ID, status: 'planned' },
        ctx: updateContext() as never,
      })).rejects.toMatchObject({ status: 422, body: { code: 'visit_availability_unavailable' } })
      expect(mockEvaluateVisitAvailability).toHaveBeenCalledTimes(1)
    })

    it('does not re-check a canceled Visit whose payload only changes the title', async () => {
      const manager = new AdvisoryLockManager()
      mockQuery.mockImplementation(async () => ({ items: [storedVisit({ status: 'canceled' })], total: 1 }))
      const bus = createVisitBookingSerializingCommandBus({
        commandBus: createContendingCommandBus({ bookings: 0 }, [], []) as never,
        em: lockingEntityManager(manager, [], []) as never,
      })
      await expect(bus.execute('customers.interactions.update', {
        input: {
          id: INTERACTION_ID,
          title: 'Renamed',
          status: 'canceled',
          scheduledAt: new Date('2026-10-01T09:00:00.000Z'),
          durationMinutes: 60,
          participants: [{ userId: USER_ID }],
        },
        ctx: updateContext() as never,
      })).resolves.toBeDefined()
      expect(mockEvaluateVisitAvailability).not.toHaveBeenCalled()
    })

    it('does not re-check a canceled Visit that is moved or canceled in the same write', async () => {
      const manager = new AdvisoryLockManager()
      mockEvaluateVisitAvailability.mockResolvedValue([
        { type: 'staff', id: USER_ID, status: 'unavailable', reasonKey: 'example.calendar.visitAvailability.booked' },
      ])
      const bus = createVisitBookingSerializingCommandBus({
        commandBus: createContendingCommandBus({ bookings: 0 }, [], []) as never,
        em: lockingEntityManager(manager, [], []) as never,
      })
      mockQuery.mockImplementation(async () => ({ items: [storedVisit({ status: 'canceled' })], total: 1 }))
      await expect(bus.execute('customers.interactions.update', {
        input: { id: INTERACTION_ID, scheduledAt: new Date('2026-10-02T13:00:00.000Z') },
        ctx: updateContext() as never,
      })).resolves.toBeDefined()
      mockQuery.mockImplementation(async () => ({ items: [storedVisit()], total: 1 }))
      await expect(bus.execute('customers.interactions.update', {
        input: { id: INTERACTION_ID, status: 'canceled', scheduledAt: new Date('2026-10-02T13:00:00.000Z') },
        ctx: updateContext() as never,
      })).resolves.toBeDefined()
      expect(mockEvaluateVisitAvailability).not.toHaveBeenCalled()
    })

    it('takes no lock and reads no record for a non-Visit interaction write', async () => {
      const manager = new AdvisoryLockManager()
      const acquiredKeys: string[] = []
      mockQuery.mockImplementation(async () => ({ items: [storedVisit({ interaction_type: 'task' })], total: 1 }))
      const bus = createVisitBookingSerializingCommandBus({
        commandBus: createContendingCommandBus({ bookings: 0 }, [], []) as never,
        em: lockingEntityManager(manager, acquiredKeys, []) as never,
      })
      await expect(bus.execute('customers.interactions.update', {
        input: { id: INTERACTION_ID, interactionType: 'task', scheduledAt: new Date('2026-10-01T11:00:00.000Z') },
        ctx: updateContext() as never,
      })).resolves.toBeDefined()
      expect(mockQuery).not.toHaveBeenCalled()
      expect(acquiredKeys).toEqual([])
      expect(mockEvaluateVisitAvailability).not.toHaveBeenCalled()
    })

    it('takes no subject lock when the stored row is not a Visit and the payload omits the type', async () => {
      const manager = new AdvisoryLockManager()
      const acquiredKeys: string[] = []
      mockQuery.mockImplementation(async () => ({ items: [storedVisit({ interaction_type: 'task' })], total: 1 }))
      const bus = createVisitBookingSerializingCommandBus({
        commandBus: createContendingCommandBus({ bookings: 0 }, [], []) as never,
        em: lockingEntityManager(manager, acquiredKeys, []) as never,
      })
      await expect(bus.execute('customers.interactions.update', {
        input: { id: INTERACTION_ID, scheduledAt: new Date('2026-10-01T11:00:00.000Z') },
        ctx: updateContext() as never,
      })).resolves.toBeDefined()
      expect(mockQuery).toHaveBeenCalledTimes(1)
      expect(acquiredKeys).toEqual([])
      expect(mockEvaluateVisitAvailability).not.toHaveBeenCalled()
    })

    it('reports a retryable 503 instead of a 500 when the locked record read fails', async () => {
      const manager = new AdvisoryLockManager()
      mockQuery.mockRejectedValue(new Error('connection reset'))
      const bus = createVisitBookingSerializingCommandBus({
        commandBus: createContendingCommandBus({ bookings: 0 }, [], []) as never,
        em: lockingEntityManager(manager, [], []) as never,
      })
      await expect(bus.execute('customers.interactions.update', {
        input: { id: INTERACTION_ID, scheduledAt: new Date('2026-10-01T11:00:00.000Z') },
        ctx: updateContext() as never,
      })).rejects.toMatchObject({ status: 503, body: { code: 'visit_availability_unavailable' } })
    })

    it('reports a retryable 503 instead of a 500 when a stored JSON column is corrupt', async () => {
      const manager = new AdvisoryLockManager()
      mockQuery.mockImplementation(async () => ({ items: [storedVisit({ participants: '{not json' })], total: 1 }))
      const bus = createVisitBookingSerializingCommandBus({
        commandBus: createContendingCommandBus({ bookings: 0 }, [], []) as never,
        em: lockingEntityManager(manager, [], []) as never,
      })
      await expect(bus.execute('customers.interactions.update', {
        input: { id: INTERACTION_ID, scheduledAt: new Date('2026-10-01T11:00:00.000Z') },
        ctx: updateContext() as never,
      })).rejects.toMatchObject({ status: 503, body: { code: 'visit_availability_unavailable' } })
      expect(mockEvaluateVisitAvailability).not.toHaveBeenCalled()
    })
  })
})
