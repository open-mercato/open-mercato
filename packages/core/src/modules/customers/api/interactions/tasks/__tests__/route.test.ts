/** @jest-environment node */

import { CustomerInteraction } from '../../../../data/entities'
import {
  CUSTOMER_INTERACTION_TASK_SOURCE,
  CUSTOMER_INTERACTION_TODO_ADAPTER_SOURCE,
  EXAMPLE_TODO_SOURCE,
} from '../../../../lib/interactionCompatibility'
import { GET } from '../route'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

jest.mock('../../../../lib/interactionRequestContext', () => ({
  resolveCustomersRequestContext: jest.fn(),
}))

jest.mock('../../../../lib/interactionFeatureFlags', () => ({
  resolveCustomerInteractionFeatureFlags: jest.fn(),
}))

jest.mock('../../../../lib/interactionReadModel', () => ({
  hydrateCanonicalInteractions: jest.fn(async ({ interactions }) =>
    interactions.map((interaction: FakeInteraction) => ({
      id: interaction.id,
      interactionType: 'task',
      title: interaction.title,
      status: interaction.status ?? 'planned',
      createdAt: interaction.createdAt.toISOString(),
      updatedAt: (interaction.updatedAt ?? interaction.createdAt).toISOString(),
      tenantId: interaction.tenantId,
      organizationId: interaction.organizationId,
      entityId: interaction.entity,
      _integrations: null,
      customValues: null,
    })),
  ),
  loadCustomerSummaries: jest.fn(async () => new Map()),
}))

const TENANT = '00000000-0000-0000-0000-000000000001'
const ORG = '00000000-0000-0000-0000-000000000002'
const OTHER_ORG = '00000000-0000-0000-0000-000000000003'
const OTHER_TENANT = '00000000-0000-0000-0000-000000000004'
const PERSON = '00000000-0000-4000-8000-000000000010'
const COMPANY = '00000000-0000-4000-8000-000000000011'

type FakeInteraction = {
  id: string
  interactionType: string
  source: string | null
  title: string
  entity: string
  tenantId: string
  organizationId: string
  createdAt: Date
  deletedAt: Date | null
  status?: string
  updatedAt?: Date
}

type FakeTodoLink = {
  id: string
  todoId: string
  todoSource: string
  entity: string
  tenantId: string
  organizationId: string
  createdAt: Date
  createdByUserId: string | null
}

type FakeStore = {
  interactions: FakeInteraction[]
  links: FakeTodoLink[]
}

function makeInteraction(overrides: Partial<FakeInteraction> & { id: string }): FakeInteraction {
  return {
    interactionType: 'task',
    source: null,
    title: 'Canonical task',
    entity: PERSON,
    tenantId: TENANT,
    organizationId: ORG,
    createdAt: new Date('2026-08-01T10:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  }
}

function makeTodoLink(overrides: Partial<FakeTodoLink> & { id: string; todoId: string }): FakeTodoLink {
  return {
    todoSource: EXAMPLE_TODO_SOURCE,
    entity: PERSON,
    tenantId: TENANT,
    organizationId: ORG,
    createdAt: new Date('2026-07-01T10:00:00.000Z'),
    createdByUserId: null,
    ...overrides,
  }
}

function matchesWhere(record: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === '$or') {
      return (condition as Array<Record<string, unknown>>).some((clause) =>
        matchesWhere(record, clause),
      )
    }
    if (key === '$and') {
      return (condition as Array<Record<string, unknown>>).every((clause) =>
        matchesWhere(record, clause),
      )
    }
    const value = record[key]
    if (condition !== null && typeof condition === 'object' && !(condition instanceof Date)) {
      const operators = condition as Record<string, unknown>
      if ('$in' in operators) return (operators.$in as unknown[]).includes(value)
      if ('$ilike' in operators) {
        const needle = String(operators.$ilike).replace(/%/g, '').toLowerCase()
        return typeof value === 'string' && value.toLowerCase().includes(needle)
      }
      if (value instanceof Date) {
        const gte = operators.$gte
        const lt = operators.$lt
        return (!(gte instanceof Date) || value >= gte) && (!(lt instanceof Date) || value < lt)
      }
      if (typeof value === 'string' && typeof operators.$lt === 'string') {
        return value < operators.$lt
      }
      return false
    }
    return value === condition
  })
}

function createFakeEntityManager(store: FakeStore) {
  const select = (entity: unknown, where: Record<string, unknown>, orderBy?: unknown) => {
    const rows: Array<Record<string, unknown>> =
      entity === CustomerInteraction
        ? (store.interactions as unknown as Array<Record<string, unknown>>)
        : (store.links as unknown as Array<Record<string, unknown>>)
    return rows
      .filter((row) => matchesWhere(row, where))
      .sort((left, right) => {
        const leftTime = (left.createdAt as Date).getTime()
        const rightTime = (right.createdAt as Date).getTime()
        return rightTime - leftTime || (Array.isArray(orderBy)
          ? String(right.id).localeCompare(String(left.id))
          : 0)
      })
  }

  const find = jest.fn(
    async (entity: unknown, where: Record<string, unknown>, options?: Record<string, unknown>) => {
      const matched = select(entity, where, options?.orderBy)
      const limit = typeof options?.limit === 'number' ? options.limit : undefined
      return limit === undefined ? matched : matched.slice(0, limit)
    },
  )

  const findAndCount = jest.fn(
    async (entity: unknown, where: Record<string, unknown>, options?: Record<string, unknown>) => {
      const matched = select(entity, where)
      const offset = typeof options?.offset === 'number' ? options.offset : 0
      const limit = typeof options?.limit === 'number' ? options.limit : undefined
      const page = limit === undefined ? matched.slice(offset) : matched.slice(offset, offset + limit)
      return [page, matched.length]
    },
  )

  return { find, findAndCount, fork: () => ({ find, findAndCount }) }
}

function createQueryEngine(store: FakeStore) {
  const linksByTodoId = new Map(store.links.map((link) => [link.todoId, link]))
  return {
    query: jest.fn(async (_source: string, options: {
      filters: { id: { $in: string[] } }
      page: { pageSize: number }
    }) => ({
      items: options.filters.id.$in
        .slice(0, options.page.pageSize)
        .flatMap((id) => linksByTodoId.get(id) ?? [])
        .map((link) => ({
          id: link.todoId,
          title: `Legacy ${link.todoId.slice(-4)}`,
          is_done: false,
          organization_id: link.organizationId,
        })),
    })),
  }
}

function primeRequestContext(store: FakeStore) {
  const em = createFakeEntityManager(store)
  const queryEngine = createQueryEngine(store)
  const container = {
    resolve: jest.fn((name: string) => {
      if (name === 'queryEngine') return queryEngine
      throw new Error(`[internal] Unexpected container resolve: ${name}`)
    }),
  }
  const { resolveCustomersRequestContext } = jest.requireMock(
    '../../../../lib/interactionRequestContext',
  )
  resolveCustomersRequestContext.mockResolvedValue({
    auth: { tenantId: TENANT, orgId: ORG, sub: 'user-1' },
    em,
    organizationIds: [ORG],
    container,
    selectedOrganizationId: ORG,
  })
  return { em, container, queryEngine }
}

function setUnified(unified: boolean) {
  const { resolveCustomerInteractionFeatureFlags } = jest.requireMock(
    '../../../../lib/interactionFeatureFlags',
  )
  resolveCustomerInteractionFeatureFlags.mockResolvedValue({
    unified,
    legacyAdapters: true,
    externalSync: false,
  })
}

function canonicalWhereClauses(em: ReturnType<typeof createFakeEntityManager>) {
  return [...em.find.mock.calls, ...em.findAndCount.mock.calls]
    .filter(([entity]) => entity === CustomerInteraction)
    .map(([, where]) => where as Record<string, unknown>)
}

type AggregateItem = {
  id: string
  todoId: string
  todoSource: string
  todoTitle: string | null
}

type AggregateResponse = {
  items: AggregateItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

async function callRoute(query = ''): Promise<{ status: number; body: AggregateResponse }> {
  const res = await GET(new Request(`http://localhost/api/customers/interactions/tasks${query}`))
  return { status: res.status, body: (await res.json()) as AggregateResponse }
}

describe('GET /api/customers/interactions/tasks', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns a canonical task written without a source in compatibility mode', async () => {
    const store: FakeStore = {
      interactions: [
        makeInteraction({ id: 'aaaaaaaa-0000-0000-0000-000000000001', title: 'Call the person' }),
        makeInteraction({
          id: 'aaaaaaaa-0000-0000-0000-000000000002',
          title: 'Call the company',
          entity: COMPANY,
          createdAt: new Date('2026-08-02T10:00:00.000Z'),
        }),
      ],
      links: [],
    }
    const { em } = primeRequestContext(store)
    setUnified(false)

    const { status, body } = await callRoute('?page=1&pageSize=50')

    expect(status).toBe(200)
    expect(body.total).toBe(2)
    expect(body.items.map((item) => item.todoTitle)).toEqual([
      'Call the company',
      'Call the person',
    ])
    expect(body.items.every((item) => item.todoSource === CUSTOMER_INTERACTION_TASK_SOURCE)).toBe(true)
    for (const where of canonicalWhereClauses(em)) {
      expect(where).not.toHaveProperty('source')
    }
  })

  it('returns each logical task once when a legacy link and its adapter bridge both exist', async () => {
    const bridgedTodoId = 'bbbbbbbb-0000-0000-0000-000000000001'
    const store: FakeStore = {
      interactions: [
        makeInteraction({
          id: bridgedTodoId,
          title: 'Bridged legacy task',
          source: CUSTOMER_INTERACTION_TODO_ADAPTER_SOURCE,
        }),
        makeInteraction({
          id: 'aaaaaaaa-0000-0000-0000-000000000003',
          title: 'Source-less task',
          createdAt: new Date('2026-08-03T10:00:00.000Z'),
        }),
      ],
      links: [makeTodoLink({ id: 'cccccccc-0000-0000-0000-000000000001', todoId: bridgedTodoId })],
    }
    primeRequestContext(store)
    setUnified(false)

    const { status, body } = await callRoute('?page=1&pageSize=50')

    expect(status).toBe(200)
    expect(body.total).toBe(2)
    expect(body.items.map((item) => item.todoTitle)).toEqual([
      'Source-less task',
      'Bridged legacy task',
    ])
    expect(
      body.items.filter((item) => item.todoId === bridgedTodoId),
    ).toHaveLength(1)
  })

  it.each([false, true])('preserves native task identity, completion and versions on person pages (unified=%s)', async (unified) => {
    const updatedAt = new Date('2026-10-16T10:00:00.000Z')
    const nativeId = 'aaaaaaaa-0000-0000-0000-000000000020'
    const sourcedId = 'aaaaaaaa-0000-0000-0000-000000000021'
    const store: FakeStore = {
      interactions: [
        makeInteraction({ id: nativeId, title: 'Native person task' }),
        makeInteraction({
          id: sourcedId,
          source: 'manual',
          title: 'Completed native task',
          status: 'done',
          updatedAt,
          createdAt: new Date('2026-08-02T10:00:00.000Z'),
        }),
        makeInteraction({ id: 'aaaaaaaa-0000-0000-0000-000000000022', entity: COMPANY }),
        makeInteraction({ id: 'aaaaaaaa-0000-0000-0000-000000000023', organizationId: OTHER_ORG }),
        makeInteraction({ id: 'aaaaaaaa-0000-0000-0000-000000000024', tenantId: OTHER_TENANT }),
      ],
      links: [],
    }
    const { em } = primeRequestContext(store)
    setUnified(unified)

    const first = await callRoute(`?entityId=${PERSON}&page=1&pageSize=1`)
    const second = await callRoute(`?entityId=${PERSON}&page=2&pageSize=1`)
    const pastEnd = await callRoute(`?entityId=${PERSON}&page=3&pageSize=1`)

    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ total: 2, page: 1, pageSize: 1, totalPages: 2 })
    expect(first.body.items).toEqual([expect.objectContaining({
      id: sourcedId,
      todoId: sourcedId,
      todoSource: CUSTOMER_INTERACTION_TASK_SOURCE,
      todoIsDone: true,
      todoUpdatedAt: updatedAt.toISOString(),
    })])
    expect(second.body.items).toEqual([expect.objectContaining({
      id: nativeId,
      todoId: nativeId,
      todoIsDone: false,
    })])
    expect(pastEnd.body.items).toEqual([])
    for (const where of canonicalWhereClauses(em)) {
      expect(where).toMatchObject({ entity: PERSON, tenantId: TENANT, organizationId: { $in: [ORG] } })
      expect(where).not.toHaveProperty('source')
    }
  })

  it('keeps an unbridged legacy todo link visible alongside canonical tasks', async () => {
    const store: FakeStore = {
      interactions: [
        makeInteraction({ id: 'aaaaaaaa-0000-0000-0000-000000000004', title: 'Canonical only' }),
      ],
      links: [
        makeTodoLink({
          id: 'cccccccc-0000-0000-0000-000000000002',
          todoId: 'dddddddd-0000-0000-0000-000000000001',
        }),
      ],
    }
    primeRequestContext(store)
    setUnified(false)

    const { status, body } = await callRoute('?page=1&pageSize=50')

    expect(status).toBe(200)
    expect(body.total).toBe(2)
    expect(body.items.map((item) => item.todoSource).sort()).toEqual([
      CUSTOMER_INTERACTION_TASK_SOURCE,
      EXAMPLE_TODO_SOURCE,
    ])
  })

  it('excludes soft-deleted canonical tasks and still suppresses their legacy row', async () => {
    const deletedBridgeId = 'bbbbbbbb-0000-0000-0000-000000000002'
    const store: FakeStore = {
      interactions: [
        makeInteraction({
          id: deletedBridgeId,
          title: 'Deleted bridged task',
          source: CUSTOMER_INTERACTION_TODO_ADAPTER_SOURCE,
          deletedAt: new Date('2026-08-04T10:00:00.000Z'),
        }),
        makeInteraction({
          id: 'aaaaaaaa-0000-0000-0000-000000000005',
          title: 'Deleted source-less task',
          deletedAt: new Date('2026-08-04T11:00:00.000Z'),
        }),
        makeInteraction({ id: 'aaaaaaaa-0000-0000-0000-000000000006', title: 'Live task' }),
      ],
      links: [makeTodoLink({ id: 'cccccccc-0000-0000-0000-000000000003', todoId: deletedBridgeId })],
    }
    primeRequestContext(store)
    setUnified(false)

    const { status, body } = await callRoute('?page=1&pageSize=50')

    expect(status).toBe(200)
    expect(body.total).toBe(1)
    expect(body.items[0]).toMatchObject({ todoTitle: 'Live task' })
  })

  it('returns the source-less canonical task in unified mode', async () => {
    const store: FakeStore = {
      interactions: [
        makeInteraction({ id: 'aaaaaaaa-0000-0000-0000-000000000007', title: 'Unified task' }),
      ],
      links: [
        makeTodoLink({
          id: 'cccccccc-0000-0000-0000-000000000004',
          todoId: 'dddddddd-0000-0000-0000-000000000002',
        }),
      ],
    }
    const { em } = primeRequestContext(store)
    setUnified(true)

    const { status, body } = await callRoute('?page=1&pageSize=50')

    expect(status).toBe(200)
    expect(body.total).toBe(1)
    expect(body.items[0]).toMatchObject({ todoTitle: 'Unified task' })
    for (const where of canonicalWhereClauses(em)) {
      expect(where).not.toHaveProperty('source')
    }
  })

  it('scopes the canonical read to the tenant and the allowed organizations', async () => {
    const store: FakeStore = {
      interactions: [
        makeInteraction({ id: 'aaaaaaaa-0000-0000-0000-000000000008', title: 'In scope' }),
        makeInteraction({
          id: 'aaaaaaaa-0000-0000-0000-000000000009',
          title: 'Other organization',
          organizationId: OTHER_ORG,
        }),
        makeInteraction({
          id: 'aaaaaaaa-0000-0000-0000-00000000000a',
          title: 'Other tenant',
          tenantId: OTHER_TENANT,
        }),
        makeInteraction({
          id: 'aaaaaaaa-0000-0000-0000-00000000000b',
          title: 'Not a task',
          interactionType: 'note',
        }),
      ],
      links: [],
    }
    const { em } = primeRequestContext(store)
    setUnified(false)

    const { status, body } = await callRoute('?page=1&pageSize=50')

    expect(status).toBe(200)
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({ todoTitle: 'In scope' })
    for (const where of canonicalWhereClauses(em)) {
      expect(where).toMatchObject({
        tenantId: TENANT,
        interactionType: 'task',
        organizationId: { $in: [ORG] },
      })
    }
  })

  it('applies search and pagination to the corrected merged set', async () => {
    const store: FakeStore = {
      interactions: [
        makeInteraction({
          id: 'aaaaaaaa-0000-0000-0000-00000000000c',
          title: 'Invoice follow-up one',
          createdAt: new Date('2026-08-05T10:00:00.000Z'),
        }),
        makeInteraction({
          id: 'aaaaaaaa-0000-0000-0000-00000000000d',
          title: 'Invoice follow-up two',
          createdAt: new Date('2026-08-05T09:00:00.000Z'),
        }),
        makeInteraction({
          id: 'aaaaaaaa-0000-0000-0000-00000000000e',
          title: 'Invoice follow-up three',
          createdAt: new Date('2026-08-05T08:00:00.000Z'),
        }),
        makeInteraction({
          id: 'aaaaaaaa-0000-0000-0000-00000000000f',
          title: 'Unrelated task',
          createdAt: new Date('2026-08-05T07:00:00.000Z'),
        }),
      ],
      links: [],
    }
    primeRequestContext(store)
    setUnified(false)

    const first = await callRoute('?page=1&pageSize=2&search=invoice')
    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ total: 3, page: 1, pageSize: 2, totalPages: 2 })
    expect(first.body.items.map((item) => item.todoTitle)).toEqual([
      'Invoice follow-up one',
      'Invoice follow-up two',
    ])

    const second = await callRoute('?page=2&pageSize=2&search=invoice')
    expect(second.body.items.map((item) => item.todoTitle)).toEqual([
      'Invoice follow-up three',
    ])
  })

  it('counts and pages matches beyond the compatibility fetch cap in both sources', async () => {
    const recent = new Date('2026-08-06T10:00:00.000Z')
    const oldest = new Date('2026-07-01T10:00:00.000Z')
    const legacyId = 'cccccccc-0000-0000-0000-000000000001'
    const canonicalId = 'aaaaaaaa-0000-0000-0000-000000000001'
    const nextCanonicalId = 'aaaaaaaa-0000-0000-0000-000000000002'
    const deletedBridgeId = 'bbbbbbbb-0000-0000-0000-000000000000'
    const otherTenantTodoId = 'eeeeeeee-0000-0000-0000-000000000000'
    const fillers = Array.from({ length: 2001 }, (_, index) =>
      (index + 1).toString(16).padStart(12, '0'),
    )
    const store: FakeStore = {
      interactions: [
        ...fillers.map((suffix) => makeInteraction({
          id: `11111111-0000-0000-0000-${suffix}`,
          createdAt: recent,
        })),
        ...fillers.slice(-100).map((suffix) => makeInteraction({
          id: `33333333-0000-0000-0000-${suffix}`,
          deletedAt: recent,
          createdAt: oldest,
        })),
        makeInteraction({ id: canonicalId, title: 'Canonical 0000', createdAt: oldest }),
        makeInteraction({ id: nextCanonicalId, title: 'Second canonical 0000', createdAt: oldest }),
        makeInteraction({ id: deletedBridgeId, deletedAt: recent, createdAt: oldest }),
        makeInteraction({ id: otherTenantTodoId, tenantId: OTHER_TENANT, title: 'Other tenant 0000' }),
      ],
      links: [
        ...fillers.map((suffix) => makeTodoLink({
          id: `22222222-0000-0000-0000-${suffix}`,
          todoId: `33333333-0000-0000-0000-${suffix}`,
          createdAt: recent,
        })),
        makeTodoLink({ id: legacyId, todoId: otherTenantTodoId, createdAt: oldest }),
        makeTodoLink({ id: 'cccccccc-0000-0000-0000-000000000002', todoId: deletedBridgeId, createdAt: recent }),
        makeTodoLink({
          id: 'cccccccc-0000-0000-0000-000000000003',
          todoId: 'ffffffff-0000-0000-0000-000000000000',
          organizationId: OTHER_ORG,
        }),
      ],
    }
    const { queryEngine } = primeRequestContext(store)
    setUnified(false)

    const first = await callRoute(`?entityId=${PERSON}&pageSize=2&search=0000`)
    const second = await callRoute(`?entityId=${PERSON}&page=2&pageSize=2&search=0000`)
    const pastEnd = await callRoute(`?entityId=${PERSON}&page=3&pageSize=2&search=0000`)
    const exported = await callRoute(`?entityId=${PERSON}&all=true&search=0000`)

    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ total: 3, page: 1, pageSize: 2, totalPages: 2 })
    expect(first.body.items.map(({ id }) => id)).toEqual([legacyId, nextCanonicalId])
    expect(second.body).toMatchObject({ total: 3, page: 2, pageSize: 2, totalPages: 2 })
    expect(second.body.items.map(({ id }) => id)).toEqual([canonicalId])
    expect(pastEnd.body).toMatchObject({ total: 3, items: [] })
    expect(exported.body).toMatchObject({ total: 3, page: 1, pageSize: 3, totalPages: 1 })
    expect(exported.body.items.map(({ id }) => id)).toEqual([legacyId, nextCanonicalId, canonicalId])
    expect(queryEngine.query.mock.calls.every(([, options]) => options.page.pageSize <= 100)).toBe(true)
  })

  it('returns the whole corrected set for all=true exports', async () => {
    const store: FakeStore = {
      interactions: [
        makeInteraction({ id: 'aaaaaaaa-0000-0000-0000-000000000010', title: 'Export one' }),
        makeInteraction({
          id: 'aaaaaaaa-0000-0000-0000-000000000011',
          title: 'Export two',
          createdAt: new Date('2026-08-06T10:00:00.000Z'),
        }),
      ],
      links: [
        makeTodoLink({
          id: 'cccccccc-0000-0000-0000-000000000005',
          todoId: 'dddddddd-0000-0000-0000-000000000003',
        }),
      ],
    }
    primeRequestContext(store)
    setUnified(false)

    const { status, body } = await callRoute('?all=true')

    expect(status).toBe(200)
    expect(body).toMatchObject({ total: 3, page: 1, pageSize: 3, totalPages: 1 })
    expect(body.items).toHaveLength(3)
  })
})
