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
      status: 'planned',
      createdAt: interaction.createdAt.toISOString(),
      updatedAt: interaction.createdAt.toISOString(),
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
const PERSON = '00000000-0000-0000-0000-000000000010'
const COMPANY = '00000000-0000-0000-0000-000000000011'

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

type FakeSubquery = {
  subqueryEntity: unknown
  subqueryWhere: Record<string, unknown>
  select: () => FakeSubquery
  where: (where: Record<string, unknown>) => FakeSubquery
}

function isFakeSubquery(value: unknown): value is FakeSubquery {
  return value !== null && typeof value === 'object' && 'subqueryEntity' in value
}

function matchesWhere(
  record: Record<string, unknown>,
  where: Record<string, unknown>,
  resolveSubquery: (subquery: FakeSubquery) => Set<unknown> = () => new Set(),
): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === '$or') {
      return (condition as Array<Record<string, unknown>>).some((clause) =>
        matchesWhere(record, clause, resolveSubquery),
      )
    }
    const value = record[key]
    if (condition !== null && typeof condition === 'object' && !(condition instanceof Date)) {
      const operators = condition as Record<string, unknown>
      if ('$in' in operators) return (operators.$in as unknown[]).includes(value)
      if ('$nin' in operators && isFakeSubquery(operators.$nin)) {
        return !resolveSubquery(operators.$nin).has(value)
      }
      if ('$ilike' in operators) {
        const needle = String(operators.$ilike).replace(/%/g, '').toLowerCase()
        return typeof value === 'string' && value.toLowerCase().includes(needle)
      }
      return false
    }
    return value === condition
  })
}

function createFakeEntityManager(store: FakeStore) {
  const select = (entity: unknown, where: Record<string, unknown>): Array<Record<string, unknown>> => {
    const rows: Array<Record<string, unknown>> =
      entity === CustomerInteraction
        ? (store.interactions as unknown as Array<Record<string, unknown>>)
        : (store.links as unknown as Array<Record<string, unknown>>)
    const resolved = new Map<FakeSubquery, Set<unknown>>()
    const resolveSubquery = (subquery: FakeSubquery) => {
      const cached = resolved.get(subquery)
      if (cached) return cached
      const ids = new Set<unknown>(select(subquery.subqueryEntity, subquery.subqueryWhere).map((row) => row.id))
      resolved.set(subquery, ids)
      return ids
    }
    return rows
      .filter((row) => matchesWhere(row, where, resolveSubquery))
      .sort((left, right) => {
        const leftTime = (left.createdAt as Date).getTime()
        const rightTime = (right.createdAt as Date).getTime()
        if (leftTime === rightTime) return String(right.id).localeCompare(String(left.id))
        return rightTime - leftTime
      })
  }

  const createQueryBuilder = jest.fn((entity: unknown) => {
    const subquery: FakeSubquery = {
      subqueryEntity: entity,
      subqueryWhere: {},
      select: () => subquery,
      where: (where) => {
        subquery.subqueryWhere = where
        return subquery
      },
    }
    return subquery
  })

  const find = jest.fn(
    async (entity: unknown, where: Record<string, unknown>, options?: Record<string, unknown>) => {
      const matched = select(entity, where)
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

  const count = jest.fn(async (entity: unknown, where: Record<string, unknown>) => select(entity, where).length)

  return { find, findAndCount, count, createQueryBuilder }
}

function createQueryEngine(store: FakeStore) {
  return {
    query: jest.fn(async () => ({
      items: store.links.map((link) => ({
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

  describe('compatibility mode beyond the merge fetch window', () => {
    const minute = 60_000
    const newest = new Date('2026-11-01T00:00:00.000Z').getTime()
    const uuid = (prefix: string, index: number) => `${prefix}-0000-0000-0000-${String(index).padStart(12, '0')}`

    it('reports the real total and returns the requested page for 2,500 legacy links', async () => {
      const links = Array.from({ length: 2500 }, (_, index) =>
        makeTodoLink({
          id: uuid('cccccccc', index),
          todoId: uuid('dddddddd', index),
          createdAt: new Date(newest - index * minute),
        }),
      )
      primeRequestContext({ interactions: [], links })
      setUnified(false)

      const middle = await callRoute('?page=19&pageSize=100')
      expect(middle.status).toBe(200)
      expect(middle.body).toMatchObject({ total: 2500, page: 19, pageSize: 100, totalPages: 25 })
      expect(middle.body.items.map((item) => item.id)).toEqual(links.slice(1800, 1900).map((link) => link.id))

      const last = await callRoute('?page=25&pageSize=100')
      expect(last.body.items.map((item) => item.id)).toEqual(links.slice(2400).map((link) => link.id))
    })

    it('counts every legacy and canonical task on the first page', async () => {
      const links = Array.from({ length: 150 }, (_, index) =>
        makeTodoLink({
          id: uuid('cccccccc', index),
          todoId: uuid('dddddddd', index),
          createdAt: new Date(newest - (2 * index + 1) * minute),
        }),
      )
      const interactions = Array.from({ length: 150 }, (_, index) =>
        makeInteraction({
          id: uuid('aaaaaaaa', index),
          createdAt: new Date(newest - 2 * index * minute),
        }),
      )
      primeRequestContext({ interactions, links })
      setUnified(false)

      const first = await callRoute('?page=1&pageSize=50')
      expect(first.body).toMatchObject({ total: 300, totalPages: 6 })
      expect(first.body.items[0]?.id).toBe(interactions[0].id)

      const last = await callRoute('?page=6&pageSize=50')
      expect(last.body.items).toHaveLength(50)
      expect(last.body.items[49]?.id).toBe(links[149].id)
    })

    it('splits tasks sharing a timestamp across pages without repeating or skipping any', async () => {
      const sameMoment = new Date(newest)
      const links = Array.from({ length: 3 }, (_, index) =>
        makeTodoLink({ id: uuid('cccccccc', index), todoId: uuid('dddddddd', index), createdAt: sameMoment }),
      )
      const interactions = Array.from({ length: 3 }, (_, index) =>
        makeInteraction({ id: uuid('aaaaaaaa', index), createdAt: sameMoment }),
      )
      primeRequestContext({ interactions, links })
      setUnified(false)

      const pages = await Promise.all([1, 2, 3].map((page) => callRoute(`?page=${page}&pageSize=2`)))
      const ids = pages.flatMap(({ body }) => body.items.map((item) => item.id))

      expect(pages.map(({ body }) => body.total)).toEqual([6, 6, 6])
      expect(new Set(ids).size).toBe(6)
      expect(ids.sort()).toEqual([...links, ...interactions].map((row) => row.id).sort())
    })

    it('returns an empty page with the real total when the page starts past the last task', async () => {
      const links = Array.from({ length: 3 }, (_, index) =>
        makeTodoLink({ id: uuid('cccccccc', index), todoId: uuid('dddddddd', index) }),
      )
      const { em } = primeRequestContext({ interactions: [], links })
      setUnified(false)

      const { status, body } = await callRoute('?page=1000000&pageSize=100')

      expect(status).toBe(200)
      expect(body).toMatchObject({ items: [], total: 3, page: 1000000, totalPages: 1 })
      expect(em.find).not.toHaveBeenCalled()
    })

    it('does not list a bridged legacy link twice when its task is older than the first page', async () => {
      const bridgedTodoId = uuid('bbbbbbbb', 1)
      const interactions = [
        ...Array.from({ length: 120 }, (_, index) =>
          makeInteraction({
            id: uuid('aaaaaaaa', index),
            createdAt: new Date(newest - index * minute),
          }),
        ),
        makeInteraction({
          id: bridgedTodoId,
          title: 'Bridged legacy task',
          source: CUSTOMER_INTERACTION_TODO_ADAPTER_SOURCE,
          createdAt: new Date(newest - 500 * minute),
        }),
      ]
      const links = [
        makeTodoLink({
          id: uuid('cccccccc', 1),
          todoId: bridgedTodoId,
          createdAt: new Date(newest - 500 * minute),
        }),
      ]
      primeRequestContext({ interactions, links })
      setUnified(false)

      const first = await callRoute('?page=1&pageSize=50')
      expect(first.body).toMatchObject({ total: 121, totalPages: 3 })

      const last = await callRoute('?page=3&pageSize=50')
      expect(last.body.items.filter((item) => item.todoId === bridgedTodoId)).toHaveLength(1)
      expect(last.body.items.find((item) => item.todoId === bridgedTodoId)?.todoSource).toBe(
        CUSTOMER_INTERACTION_TASK_SOURCE,
      )
    })
  })
})
