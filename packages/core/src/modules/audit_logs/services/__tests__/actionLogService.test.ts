import { ActionLogService } from '../actionLogService'

type OrGroup = { __group: 'or'; children: unknown[] }
type ExpressionBuilderMock = ((...args: unknown[]) => unknown) & {
  and: (children: unknown[]) => unknown
  or: (children: unknown[]) => unknown
}
type WhereCallback = (eb: ExpressionBuilderMock) => unknown
type FakeQueryBuilder = {
  selectAll: () => FakeQueryBuilder
  where: (...args: unknown[]) => FakeQueryBuilder
  orderBy: () => FakeQueryBuilder
  _state: { wheres: WhereCallback[] }
}

function buildServiceForQueryInspection(): {
  service: ActionLogService
  build: (query: Record<string, unknown>) => { orGroup: OrGroup | null }
} {
  const fakeKysely = {
    selectFrom(_table: string) {
      const state: FakeQueryBuilder['_state'] = { wheres: [] }
      const builder: FakeQueryBuilder = {
        selectAll: () => builder,
        where: (...args: unknown[]) => {
          if (typeof args[0] === 'function') {
            state.wheres.push(args[0] as WhereCallback)
          }
          return builder
        },
        orderBy: () => builder,
        _state: state,
      }
      return builder
    },
  }
  const fakeEm = { getKysely: () => fakeKysely }
  const service = new ActionLogService(fakeEm as unknown as ConstructorParameters<typeof ActionLogService>[0])
  const serviceWithPrivate = service as unknown as {
    buildListQuery: (parsed: Record<string, unknown>) => FakeQueryBuilder
    parseListQuery: (query: Record<string, unknown>) => Record<string, unknown>
  }
  return {
    service,
    build: (query) => {
      const parsed = serviceWithPrivate.parseListQuery(query)
      const builder = serviceWithPrivate.buildListQuery(parsed)
      let orGroup: OrGroup | null = null
      const ebMock = ((..._args: unknown[]) => ({ __leaf: true })) as ExpressionBuilderMock
      ebMock.and = (children: unknown[]) => ({ __group: 'and', children })
      ebMock.or = (children: unknown[]) => {
        const group: OrGroup = { __group: 'or', children }
        orGroup = group
        return group
      }
      for (const w of builder._state.wheres) {
        try {
          w(ebMock)
        } catch {
          continue
        }
      }
      return { orGroup }
    },
  }
}

describe('ActionLogService.buildListQuery - related resource filter', () => {
  it('adds a generic related-resource OR branch with includeRelated', () => {
    const { build } = buildServiceForQueryInspection()
    const { orGroup } = build({
      tenantId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      resourceKind: 'customers.deal',
      resourceId: 'deal-1',
      includeRelated: true,
    })
    expect(orGroup).not.toBeNull()
    expect(orGroup!.children.length).toBe(3)
  })

  it('uses the same related-resource branch for non-deal resources with includeRelated', () => {
    const { build } = buildServiceForQueryInspection()
    const { orGroup } = build({
      tenantId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      resourceKind: 'customers.person',
      resourceId: 'person-1',
      includeRelated: true,
    })
    expect(orGroup).not.toBeNull()
    expect(orGroup!.children.length).toBe(3)
  })

  it('emits no OR group when includeRelated is false for deals', () => {
    const { build } = buildServiceForQueryInspection()
    const { orGroup } = build({
      tenantId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      resourceKind: 'customers.deal',
      resourceId: 'deal-1',
      includeRelated: false,
    })
    expect(orGroup).toBeNull()
  })
})

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
      relatedResourceKind: 'customers.deal',
      relatedResourceId: 'deal-1',
    })

    expect(normalized.actionLabel).toBeUndefined()
    expect(normalized.resourceKind).toBeUndefined()
    expect(normalized.resourceId).toBeUndefined()
    expect(normalized.undoToken).toBeUndefined()
    expect(normalized.parentResourceKind).toBeNull()
    expect(normalized.parentResourceId).toBeNull()
    expect(normalized.relatedResourceKind).toBe('customers.deal')
    expect(normalized.relatedResourceId).toBe('deal-1')
  })

  it('defaults related resource fields to null when fallback normalization receives no input', () => {
    const service = new ActionLogService({} as unknown as ConstructorParameters<typeof ActionLogService>[0])
    const serviceWithPrivateAccess = service as unknown as {
      normalizeInput: (input: null) => Record<string, unknown>
    }
    const normalized = serviceWithPrivateAccess.normalizeInput(null)

    expect(normalized.relatedResourceKind).toBeNull()
    expect(normalized.relatedResourceId).toBeNull()
  })

  it('normalizes only UUID actor ids into the uuid-backed actor column', () => {
    const service = new ActionLogService({} as unknown as ConstructorParameters<typeof ActionLogService>[0])
    const serviceWithPrivateAccess = service as unknown as {
      normalizeInput: (input: Record<string, unknown>) => Record<string, unknown>
    }

    expect(serviceWithPrivateAccess.normalizeInput({
      commandId: 'example.todos.create',
      actorUserId: 'system:example_customers_sync:outbound',
    }).actorUserId).toBeNull()

    expect(serviceWithPrivateAccess.normalizeInput({
      commandId: 'customers.people.update',
      actorUserId: '11111111-1111-4111-8111-111111111111',
    }).actorUserId).toBe('11111111-1111-4111-8111-111111111111')

    expect(serviceWithPrivateAccess.normalizeInput({
      commandId: 'api.something',
      actorUserId: 'api_key:22222222-2222-4222-8222-222222222222',
    }).actorUserId).toBe('22222222-2222-4222-8222-222222222222')

    expect(serviceWithPrivateAccess.normalizeInput({
      commandId: 'test',
      actorUserId: 'not-a-uuid',
    }).actorUserId).toBeNull()
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
      relatedResourceKind: 'customers.deal',
      relatedResourceId: 'deal-1',
      snapshotBefore: { entity: { displayName: 'Acme' } },
      tenantId: 'tenant-1',
    })

    expect(created.actionType).toBe('edit')
    expect(created.sourceKey).toBe('ui')
    expect(created.changedFields).toEqual(['entity.displayName'])
    expect(created.primaryChangedField).toBe('entity.displayName')
    expect(created.relatedResourceKind).toBe('customers.deal')
    expect(created.relatedResourceId).toBe('deal-1')
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
