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
  resolveAuthActorId: jest.fn((auth: { sub?: string }) => auth.sub ?? 'system'),
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
      priority: interaction.priority ?? null,
      scheduledAt: interaction.scheduledAt ? interaction.scheduledAt.toISOString() : null,
      ownerUserId: interaction.ownerUserId ?? null,
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
  priority?: number | null
  scheduledAt?: Date | null
  ownerUserId?: string | null
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

type FakeSubquery = { __fakeSubquery: true; entity: unknown; where: Record<string, unknown> }

function isFakeSubquery(value: unknown): value is FakeSubquery {
  return typeof value === 'object' && value !== null && (value as FakeSubquery).__fakeSubquery === true
}

let activeStore: FakeStore | null = null

function resolveSubqueryIds(subquery: FakeSubquery): unknown[] {
  const rows = subquery.entity === CustomerInteraction
    ? (activeStore?.interactions ?? []) as unknown as Array<Record<string, unknown>>
    : (activeStore?.links ?? []) as unknown as Array<Record<string, unknown>>
  return rows.filter((row) => matchesWhere(row, subquery.where)).map((row) => row.id)
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
      if ('$nin' in operators) {
        const excluded = isFakeSubquery(operators.$nin) ? resolveSubqueryIds(operators.$nin) : (operators.$nin as unknown[])
        return value !== null && value !== undefined && !excluded.includes(value)
      }
      if ('$ilike' in operators) {
        const needle = String(operators.$ilike).replace(/%/g, '').toLowerCase()
        return typeof value === 'string' && value.toLowerCase().includes(needle)
      }
      const comparable = value instanceof Date ? value.getTime() : value
      const bound = (operand: unknown) => (operand instanceof Date ? operand.getTime() : operand) as number
      if (comparable === null || comparable === undefined) return false
      if ('$gte' in operators && !((comparable as number) >= bound(operators.$gte))) return false
      if ('$lt' in operators && !((comparable as number) < bound(operators.$lt))) return false
      if ('$lte' in operators && !((comparable as number) <= bound(operators.$lte))) return false
      return '$gte' in operators || '$lt' in operators || '$lte' in operators
    }
    if (condition === null) return value === null || value === undefined
    return value === condition
  })
}

function createFakeEntityManager(store: FakeStore) {
  const select = (entity: unknown, where: Record<string, unknown>, orderBy?: Record<string, string>) => {
    const rows: Array<Record<string, unknown>> =
      entity === CustomerInteraction
        ? (store.interactions as unknown as Array<Record<string, unknown>>)
        : (store.links as unknown as Array<Record<string, unknown>>)
    const primary = orderBy ? Object.entries(orderBy).find(([field]) => field === 'priority' || field === 'scheduledAt') : undefined
    const numeric = (value: unknown) => (value instanceof Date ? value.getTime() : typeof value === 'number' ? value : null)
    return rows
      .filter((row) => matchesWhere(row, where))
      .sort((left, right) => {
        if (primary) {
          const [field, direction] = primary
          const leftValue = numeric(left[field])
          const rightValue = numeric(right[field])
          if (leftValue !== rightValue) {
            if (leftValue === null) return 1
            if (rightValue === null) return -1
            return direction.toLowerCase().startsWith('asc') ? leftValue - rightValue : rightValue - leftValue
          }
        }
        const leftTime = (left.createdAt as Date).getTime()
        const rightTime = (right.createdAt as Date).getTime()
        return rightTime - leftTime
      })
  }

  const find = jest.fn(
    async (entity: unknown, where: Record<string, unknown>, options?: Record<string, unknown>) => {
      const matched = select(entity, where, options?.orderBy as Record<string, string> | undefined)
      const limit = typeof options?.limit === 'number' ? options.limit : undefined
      return limit === undefined ? matched : matched.slice(0, limit)
    },
  )

  const findAndCount = jest.fn(
    async (entity: unknown, where: Record<string, unknown>, options?: Record<string, unknown>) => {
      const matched = select(entity, where, options?.orderBy as Record<string, string> | undefined)
      const offset = typeof options?.offset === 'number' ? options.offset : 0
      const limit = typeof options?.limit === 'number' ? options.limit : undefined
      const page = limit === undefined ? matched.slice(offset) : matched.slice(offset, offset + limit)
      return [page, matched.length]
    },
  )

  const createQueryBuilder = jest.fn((entity: unknown) => {
    const subquery: FakeSubquery = { __fakeSubquery: true, entity, where: {} }
    const builder = {
      select: () => builder,
      where: (where: Record<string, unknown>) => {
        subquery.where = where
        return subquery
      },
    }
    return builder
  })

  activeStore = store
  return { find, findAndCount, createQueryBuilder }
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
  it('applies status, due date, priority and owner filters on the canonical read in unified mode', async () => {
    const store: FakeStore = { interactions: [], links: [] }
    const { em } = primeRequestContext(store)
    setUnified(true)

    const { status } = await callRoute(
      '?status=open&dueFrom=2026-11-01&dueTo=2026-11-30&priorityMin=10&priorityMax=90&ownerUserId=me&sortField=dueAt&sortDir=asc',
    )

    expect(status).toBe(200)
    const [, where, options] = em.findAndCount.mock.calls[0]
    expect(where).toMatchObject({ tenantId: TENANT, interactionType: 'task' })
    expect((where as Record<string, unknown>).$and).toEqual([
      { $or: [{ status: null }, { status: { $nin: ['done', 'canceled', 'completed'] } }] },
      { scheduledAt: { $gte: new Date('2026-11-01T00:00:00.000Z') } },
      { scheduledAt: { $lt: new Date('2026-12-01T00:00:00.000Z') } },
      { priority: { $gte: 10 } },
      { priority: { $lte: 90 } },
      { ownerUserId: 'user-1' },
    ])
    expect(options).toMatchObject({ orderBy: { scheduledAt: 'ASC NULLS LAST', createdAt: 'DESC', id: 'DESC' } })
  })

  it('narrows the merged compatibility list by completion status', async () => {
    const store: FakeStore = {
      interactions: [
        makeInteraction({ id: 'aaaaaaaa-0000-0000-0000-000000000020', title: 'Open CRM task' }),
        makeInteraction({
          id: 'aaaaaaaa-0000-0000-0000-000000000021',
          title: 'Done CRM task',
          status: 'done',
          createdAt: new Date('2026-08-07T10:00:00.000Z'),
        }),
      ],
      links: [
        makeTodoLink({
          id: 'cccccccc-0000-0000-0000-000000000020',
          todoId: 'dddddddd-0000-0000-0000-000000000020',
        }),
      ],
    }
    primeRequestContext(store)
    setUnified(false)

    const done = await callRoute('?status=done')
    expect(done.status).toBe(200)
    expect(done.body.items.map((item) => item.todoTitle)).toEqual(['Done CRM task'])
    expect(done.body.total).toBe(1)

    const open = await callRoute('?status=open')
    expect(open.status).toBe(200)
    expect(open.body.items.map((item) => item.todoTitle)).toEqual(['Open CRM task', 'Legacy 0020'])
    expect(open.body.total).toBe(2)
  })

  it('rejects an owner filter that is neither a uuid nor me', async () => {
    primeRequestContext({ interactions: [], links: [] })
    setUnified(true)

    const { status } = await callRoute('?ownerUserId=someone')

    expect(status).toBe(400)
  })
  describe('compatibility mode applies criteria before the page window', () => {
    const OWNER = '00000000-0000-4000-8000-0000000000aa'

    function newerTasks(count: number, overrides: Partial<FakeInteraction> = {}): FakeInteraction[] {
      return Array.from({ length: count }, (_, index) => makeInteraction({
        id: `bbbbbbbb-0000-4000-8000-${String(index).padStart(12, '0')}`,
        title: `Newer task ${index}`,
        createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, index)),
        ...overrides,
      }))
    }

    it('finds the only owner match even when 2,100 newer tasks precede it', async () => {
      const store: FakeStore = {
        interactions: [
          ...newerTasks(2100),
          makeInteraction({
            id: 'aaaaaaaa-0000-4000-8000-000000000099',
            title: 'Owned old task',
            createdAt: new Date('2026-01-01T10:00:00.000Z'),
            ownerUserId: OWNER,
          }),
        ],
        links: [],
      }
      primeRequestContext(store)
      setUnified(false)

      const { status, body } = await callRoute(`?ownerUserId=${OWNER}&page=1&pageSize=5`)

      expect(status).toBe(200)
      expect(body.total).toBe(1)
      expect(body.items.map((item) => item.todoTitle)).toEqual(['Owned old task'])
    })

    it('sorts by priority across the whole set before paging', async () => {
      const store: FakeStore = {
        interactions: [
          ...newerTasks(2100, { priority: 10 }),
          makeInteraction({
            id: 'aaaaaaaa-0000-4000-8000-000000000098',
            title: 'Old urgent task',
            createdAt: new Date('2026-01-01T10:00:00.000Z'),
            priority: 95,
          }),
        ],
        links: [],
      }
      primeRequestContext(store)
      setUnified(false)

      const { status, body } = await callRoute('?sortField=priority&sortDir=desc&page=1&pageSize=1')

      expect(status).toBe(200)
      expect(body.total).toBe(2101)
      expect(body.items.map((item) => item.todoTitle)).toEqual(['Old urgent task'])
    })

    it('keeps an older open legacy todo when many newer tasks are completed', async () => {
      const store: FakeStore = {
        interactions: newerTasks(2100, { status: 'done' }),
        links: [
          makeTodoLink({
            id: 'cccccccc-0000-4000-8000-000000000097',
            todoId: 'dddddddd-0000-4000-8000-000000000097',
            createdAt: new Date('2026-01-01T10:00:00.000Z'),
          }),
        ],
      }
      primeRequestContext(store)
      setUnified(false)

      const { status, body } = await callRoute('?status=open&page=1&pageSize=5')

      expect(status).toBe(200)
      expect(body.total).toBe(1)
      expect(body.items.map((item) => item.todoTitle)).toEqual(['Legacy 0097'])
    })
  })
  it('matches search on decrypted titles in unified mode without reading legacy links', async () => {
    const store: FakeStore = {
      interactions: [
        makeInteraction({ id: 'aaaaaaaa-0000-4000-8000-000000000201', title: 'Quarterly review call' }),
        makeInteraction({ id: 'aaaaaaaa-0000-4000-8000-000000000202', title: 'Send pricing deck' }),
      ],
      links: [
        makeTodoLink({ id: 'cccccccc-0000-4000-8000-000000000201', todoId: 'dddddddd-0000-4000-8000-000000000201' }),
      ],
    }
    const { em } = primeRequestContext(store)
    setUnified(true)

    const { status, body } = await callRoute('?search=quarterly&page=1&pageSize=10')

    expect(status).toBe(200)
    expect(body.items.map((item) => item.todoTitle)).toEqual(['Quarterly review call'])
    expect(canonicalWhereClauses(em).every((where) => !('$or' in where))).toBe(true)
    expect(em.find.mock.calls.some(([entity]) => entity !== CustomerInteraction)).toBe(false)
  })
})
