import { ActionLogService } from '../actionLogService'

describe('ActionLogService normalizeInput', () => {
  it('maps optional strings to undefined and parent fields to null', () => {
    const service = new ActionLogService({} as unknown as ConstructorParameters<typeof ActionLogService>[0])
    const serviceWithPrivateAccess = service as unknown as {
      normalizeInput: (input: Record<string, unknown>) => Record<string, unknown>
    }
    const normalized = serviceWithPrivateAccess.normalizeInput({
      commandId: 'cmd-1',
      actionLabel: null,
      resourceKind: '',
      resourceId: undefined,
      undoToken: null,
      parentResourceKind: '',
      parentResourceId: undefined,
    })

    expect(normalized.actionLabel).toBeUndefined()
    expect(normalized.resourceKind).toBeUndefined()
    expect(normalized.resourceId).toBeUndefined()
    expect(normalized.undoToken).toBeUndefined()
    expect(normalized.parentResourceKind).toBeNull()
    expect(normalized.parentResourceId).toBeNull()
  })

  it('rejects non-UUID actorUserId so system-originated commands (sync workers, scheduler) never blow up the action log driver with `invalid input syntax for type uuid`', () => {
    const service = new ActionLogService({} as unknown as ConstructorParameters<typeof ActionLogService>[0])
    const serviceWithPrivateAccess = service as unknown as {
      normalizeInput: (input: Record<string, unknown>) => Record<string, unknown>
    }

    const systemSub = serviceWithPrivateAccess.normalizeInput({
      commandId: 'example.todos.create',
      actorUserId: 'system:example_customers_sync:outbound',
    })
    expect(systemSub.actorUserId).toBeNull()

    const realUser = serviceWithPrivateAccess.normalizeInput({
      commandId: 'customers.people.update',
      actorUserId: '11111111-1111-4111-8111-111111111111',
    })
    expect(realUser.actorUserId).toBe('11111111-1111-4111-8111-111111111111')

    const apiKey = serviceWithPrivateAccess.normalizeInput({
      commandId: 'api.something',
      actorUserId: 'api_key:22222222-2222-4222-8222-222222222222',
    })
    expect(apiKey.actorUserId).toBe('22222222-2222-4222-8222-222222222222')

    const garbage = serviceWithPrivateAccess.normalizeInput({
      commandId: 'test',
      actorUserId: 'not-a-uuid',
    })
    expect(garbage.actorUserId).toBeNull()
  })

  it('populates projection columns when creating a log entity', () => {
    const service = new ActionLogService(
      {} as unknown as ConstructorParameters<typeof ActionLogService>[0],
      { isEnabled: () => true } as unknown as ConstructorParameters<typeof ActionLogService>[1],
    )

    const serviceWithPrivateAccess = service as unknown as {
      createLogEntity: (
        fork: { create: (_entity: unknown, payload: Record<string, unknown>) => Record<string, unknown> },
        query: Record<string, unknown>,
      ) => Record<string, unknown>
    }

    const created = serviceWithPrivateAccess.createLogEntity({
      create: (_entity, payload) => payload,
    }, {
      actorUserId: 'user-1',
      actionLabel: 'Update company',
      changes: {
        'entity.displayName': { from: 'Acme', to: 'Copperleaf' },
      },
      commandId: 'customers.companies.update',
      context: {
        source: 'ui',
      },
      createdAt: new Date('2026-04-12T10:00:00.000Z'),
      executionState: 'done',
      organizationId: 'org-1',
      resourceId: 'company-1',
      resourceKind: 'customers.company',
      snapshotBefore: { entity: { displayName: 'Acme' } },
      tenantId: 'tenant-1',
    })

    expect(created.actionType).toBe('edit')
    expect(created.sourceKey).toBe('ui')
    expect(created.changedFields).toEqual(['entity.displayName'])
    expect(created.primaryChangedField).toBe('entity.displayName')
  })
})

describe('ActionLogService.list pagination', () => {
  function buildServiceWithSpies(items: unknown[], total: number) {
    const service = new ActionLogService({} as unknown as ConstructorParameters<typeof ActionLogService>[0])
    const loadEntries = jest.spyOn(service as any, 'loadEntries').mockResolvedValue(items as any)
    const count = jest.spyOn(service as any, 'count').mockResolvedValue(total)
    return { service, loadEntries, count }
  }

  it('returns pagination envelope derived from page/pageSize', async () => {
    const mockItems = [{ id: '1' }, { id: '2' }]
    const { service } = buildServiceWithSpies(mockItems, 42)

    const result = await service.list({
      tenantId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      page: 3,
      pageSize: 10,
    })

    expect(result.items).toBe(mockItems)
    expect(result.total).toBe(42)
    expect(result.page).toBe(3)
    expect(result.pageSize).toBe(10)
    expect(result.totalPages).toBe(5)
  })

  it('defaults to page=1 pageSize=50 when not provided', async () => {
    const { service } = buildServiceWithSpies([], 0)

    const result = await service.list({
      tenantId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    })

    expect(result.page).toBe(1)
    expect(result.pageSize).toBe(50)
    expect(result.totalPages).toBe(1)
    expect(result.total).toBe(0)
  })

  it('computes totalPages correctly for partial last page', async () => {
    const { service } = buildServiceWithSpies([], 101)

    const result = await service.list({
      tenantId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      pageSize: 25,
    })

    expect(result.totalPages).toBe(5)
  })

  it('returns totalPages=1 when total is 0', async () => {
    const { service } = buildServiceWithSpies([], 0)

    const result = await service.list({
      tenantId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    })

    expect(result.totalPages).toBe(1)
  })
})
