import { NextRequest } from 'next/server'
import { RawQueryFragment } from '@mikro-orm/core'
import type { CodeWorkflowDefinition } from '@open-mercato/shared/modules/workflows'
import { GET as listDefinitions, metadata as definitionsMetadata } from '../definitions/route'
import { GET as listInstances, metadata as instancesMetadata } from '../instances/route'
import { GET as listInstanceEvents, metadata as instanceEventsMetadata } from '../instances/[id]/events/route'
import { GET as listEvents, metadata as eventsMetadata } from '../events/route'
import { WorkflowDefinition, WorkflowEvent, WorkflowInstance } from '../../data/entities'
import { getAllCodeWorkflows } from '../../lib/code-registry'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))

jest.mock('../../lib/code-registry', () => ({
  getAllCodeWorkflows: jest.fn(),
  getCodeWorkflow: jest.fn(),
}))

const tenantId = 'tenant-pagination'
const organizationId = 'organization-pagination'
const instanceId = '11111111-1111-4111-8111-111111111111'
const scopedWhere = { tenantId, organizationId: { $in: [organizationId] } }
const mockGetAllCodeWorkflows = jest.mocked(getAllCodeWorkflows)

const invalidOffsetQueries = [
  'limit=101',
  'limit=99999999999999999999999',
  'limit=-1',
  'limit=0',
  'limit=abc',
  'limit=1.5',
  'limit=50trailing',
  'limit=Infinity',
  'limit=NaN',
  'limit=1e309',
  'limit=',
  'limit=%20',
  'offset=100001',
  'offset=99999999999999999999999',
  'offset=-1',
  'offset=abc',
  'offset=1.5',
  'offset=10trailing',
  'offset=Infinity',
  'offset=NaN',
  'offset=1e309',
  'offset=',
  'offset=%20',
]

const offsetRoutes = [
  { name: 'definitions', path: 'definitions', run: listDefinitions, defaultLimit: 50 },
  { name: 'instances', path: 'instances', run: listInstances, defaultLimit: 50 },
  {
    name: 'instance events',
    path: `instances/${instanceId}/events`,
    run: (request: NextRequest) => listInstanceEvents(request, { params: Promise.resolve({ id: instanceId }) }),
    defaultLimit: 100,
  },
]

function codeDefinition(workflowId: string, workflowName: string): CodeWorkflowDefinition {
  return {
    workflowId,
    workflowName,
    description: null,
    version: 1,
    enabled: true,
    metadata: null,
    moduleId: 'pagination_tests',
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [{ transitionId: 'finish', fromStepId: 'start', toStepId: 'end', trigger: 'auto' }],
    },
  }
}

function databaseDefinition(index: number) {
  return {
    id: `database-${index}`,
    workflowId: `database-${index}`,
    workflowName: `Workflow ${String(index).padStart(6, '0')}`,
    version: 1,
    definition: { steps: [], transitions: [] },
    enabled: true,
    kind: 'workflow',
    lifecycle: 'published',
    tenantId,
    organizationId,
  }
}

describe('Workflow list pagination boundaries', () => {
  let mockEm: {
    find: jest.Mock
    findOne: jest.Mock
    findAndCount: jest.Mock
    count: jest.Mock
  }
  let mockRbacService: { userHasAllFeatures: jest.Mock }

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAllCodeWorkflows.mockReturnValue([])
    mockEm = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({ id: instanceId }),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      count: jest.fn().mockResolvedValue(0),
    }
    mockRbacService = { userHasAllFeatures: jest.fn().mockResolvedValue(true) }

    const { createRequestContainer } = require('@open-mercato/shared/lib/di/container')
    createRequestContainer.mockResolvedValue({
      resolve: (name: string) => {
        if (name === 'em') return mockEm
        if (name === 'rbacService') return mockRbacService
        return null
      },
    })
    const { getAuthFromRequest } = require('@open-mercato/shared/lib/auth/server')
    getAuthFromRequest.mockResolvedValue({ sub: 'pagination-user', tenantId, orgId: organizationId })
    const { resolveOrganizationScopeForRequest } = require('@open-mercato/core/modules/directory/utils/organizationScope')
    resolveOrganizationScopeForRequest.mockResolvedValue({ selectedId: organizationId })
  })

  function expectNoDataLookup() {
    expect(mockEm.find).not.toHaveBeenCalled()
    expect(mockEm.findOne).not.toHaveBeenCalled()
    expect(mockEm.findAndCount).not.toHaveBeenCalled()
    expect(mockEm.count).not.toHaveBeenCalled()
  }

  test('retains authentication and feature gates on all four list endpoints', () => {
    expect(definitionsMetadata).toMatchObject({ requireAuth: true, requireFeatures: ['workflows.definitions.view'] })
    for (const metadata of [instancesMetadata, instanceEventsMetadata, eventsMetadata]) {
      expect(metadata).toMatchObject({ requireAuth: true, requireFeatures: ['workflows.instances.view'] })
    }
  })

  describe.each(offsetRoutes)('$name', ({ path, run, defaultLimit }) => {
    test.each(invalidOffsetQueries)('rejects %s before reading workflow data', async (query) => {
      const response = await run(new NextRequest(`http://localhost/api/workflows/${path}?${query}`))

      expect(response.status).toBe(400)
      expect(await response.json()).toHaveProperty('error')
      expectNoDataLookup()
    })

    test('preserves the default pagination envelope', async () => {
      const response = await run(new NextRequest(`http://localhost/api/workflows/${path}`))

      expect(response.status).toBe(200)
      expect((await response.json()).pagination).toEqual({
        total: 0,
        limit: defaultLimit,
        offset: 0,
        hasMore: false,
      })
    })
  })

  test.each([
    'pageSize=101', 'pageSize=99999999999999999999999', 'pageSize=0', 'pageSize=-1',
    'pageSize=abc', 'pageSize=1.5', 'pageSize=50trailing', 'pageSize=Infinity',
    'pageSize=NaN', 'pageSize=1e309', 'pageSize=', 'pageSize=%20',
    'page=0', 'page=-1', 'page=abc', 'page=1.5', 'page=10trailing',
    'page=Infinity', 'page=NaN', 'page=1e309', 'page=', 'page=%20',
    'page=100002&pageSize=1', 'page=1002&pageSize=100',
    'page=9007199254740992&pageSize=100',
  ])('global events reject %s before reading workflow data', async (query) => {
    const response = await listEvents(new NextRequest(`http://localhost/api/workflows/events?${query}`))

    expect(response.status).toBe(400)
    expect(await response.json()).toHaveProperty('error')
    expectNoDataLookup()
  })

  test('global events preserve defaults and scope both event and related-instance reads', async () => {
    const response = await listEvents(new NextRequest('http://localhost/api/workflows/events'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ items: [], total: 0, page: 1, pageSize: 50, totalPages: 0 })
    expect(mockEm.findAndCount).toHaveBeenCalledWith(
      WorkflowEvent,
      expect.objectContaining(scopedWhere),
      expect.objectContaining({ limit: 50, offset: 0 }),
    )
    expect(mockEm.find).toHaveBeenCalledWith(WorkflowInstance, expect.objectContaining(scopedWhere))
    expect(mockRbacService.userHasAllFeatures).toHaveBeenCalledWith(
      'pagination-user', ['workflows.instances.view'], { tenantId, organizationId },
    )
  })

  test('global events accept the maximum derived offset', async () => {
    const response = await listEvents(new NextRequest('http://localhost/api/workflows/events?page=1001&pageSize=100'))

    expect(response.status).toBe(200)
    expect(mockEm.findAndCount).toHaveBeenCalledWith(
      WorkflowEvent, expect.objectContaining(scopedWhere), expect.objectContaining({ limit: 100, offset: 100000 }),
    )
  })

  test('instances accept boundary values without weakening tenant and organization predicates', async () => {
    const response = await listInstances(new NextRequest('http://localhost/api/workflows/instances?limit=100&offset=100000'))

    expect(response.status).toBe(200)
    expect(mockEm.findAndCount).toHaveBeenCalledWith(
      WorkflowInstance, expect.objectContaining(scopedWhere), expect.objectContaining({ limit: 100, offset: 100000 }),
    )
  })

  test('instance events scope the parent lookup and paginated events at the boundary', async () => {
    const response = await listInstanceEvents(
      new NextRequest(`http://localhost/api/workflows/instances/${instanceId}/events?limit=100&offset=100000`),
      { params: Promise.resolve({ id: instanceId }) },
    )

    expect(response.status).toBe(200)
    expect(mockEm.findOne).toHaveBeenCalledWith(
      WorkflowInstance, expect.objectContaining({ id: instanceId, ...scopedWhere }),
    )
    expect(mockEm.findAndCount).toHaveBeenCalledWith(
      WorkflowEvent,
      expect.objectContaining({ workflowInstanceId: instanceId, ...scopedWhere }),
      expect.objectContaining({ limit: 100, offset: 100000 }),
    )
  })

  test('definitions fetch a single database page at a large offset without reading the prefix', async () => {
    const definitions = [databaseDefinition(100000), databaseDefinition(100001)]
    mockEm.count.mockResolvedValue(100010)
    mockEm.find.mockResolvedValue(definitions)

    const response = await listDefinitions(new NextRequest('http://localhost/api/workflows/definitions?limit=2&offset=100000'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.map((row: { id: string }) => row.id)).toEqual(definitions.map((row) => row.id))
    expect(body.pagination).toEqual({ total: 100010, limit: 2, offset: 100000, hasMore: true })
    expect(mockEm.find).toHaveBeenCalledTimes(1)
    expect(mockEm.find).toHaveBeenCalledWith(
      WorkflowDefinition,
      expect.objectContaining({ ...scopedWhere, deletedAt: null }),
      expect.objectContaining({ limit: 2, offset: 100000, orderBy: expect.any(Array) }),
    )
    const orderBy = mockEm.find.mock.calls[0][2].orderBy as Array<Record<PropertyKey, unknown>>
    expect(orderBy).toHaveLength(2)
    const nameOrderKey = Reflect.ownKeys(orderBy[0])[0]
    expect(RawQueryFragment.getKnownFragment(nameOrderKey)?.sql).toContain('.workflow_name COLLATE "C"')
    expect(orderBy[0][nameOrderKey]).toBe('ASC')
    expect(orderBy[1]).toEqual({ id: 'ASC' })
  })

  test.each([0, 1, 3, 5, 7, 10, 11, 13])('definitions preserve merged ordering at offset %i', async (offset) => {
    const definitions = Array.from({ length: 10 }, (_, index) => databaseDefinition(index))
    const codeDefinitions = [
      codeDefinition('code-before', 'Before'),
      codeDefinition('code-middle', 'Workflow 000004.5'),
      codeDefinition('code-equal', 'Workflow 000005'),
      codeDefinition('code-after', 'Zebra'),
    ]
    mockGetAllCodeWorkflows.mockReturnValue(codeDefinitions)
    mockEm.count.mockResolvedValue(definitions.length)
    mockEm.find.mockImplementation(async (
      _entity: unknown,
      _where: unknown,
      options: { fields?: string[]; limit: number; offset?: number },
    ) => options.fields ? [] : definitions.slice(options.offset ?? 0, (options.offset ?? 0) + options.limit))
    const expected = [...definitions, ...codeDefinitions.map((definition) => ({
      ...definition, id: `code:${definition.workflowId}`,
    }))].sort((left, right) => Buffer.compare(Buffer.from(left.workflowName), Buffer.from(right.workflowName))).slice(offset, offset + 3)

    const response = await listDefinitions(new NextRequest(`http://localhost/api/workflows/definitions?limit=3&offset=${offset}`))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.map((row: { id: string }) => row.id)).toEqual(expected.map((row) => row.id))
    expect(body.pagination).toEqual({ total: 14, limit: 3, offset, hasMore: offset + 3 < 14 })
    const pageCalls = mockEm.find.mock.calls.filter((call) => !call[2]?.fields)
    for (const call of pageCalls) {
      expect(call[2]).toMatchObject({ limit: 7, offset: Math.max(0, offset - 4) })
    }
  })

  test.each([0, 3, 6, 9, 12])('definitions merge case and Unicode names in UTF-8 byte order at offset %i', async (offset) => {
    const databaseNames = ['B', 'D', 'a', 'c', 'é', '𝒜']
    const codeNames = ['A', 'C', 'b', 'd', 'e', 'ø', '\uE000', '𝒝']
    const expectedNames = ['A', 'B', 'C', 'D', 'a', 'b', 'c', 'd', 'e', 'é', 'ø', '\uE000', '𝒜', '𝒝']
    const definitions = databaseNames.map((workflowName, index) => ({ ...databaseDefinition(index), workflowName }))
    mockGetAllCodeWorkflows.mockReturnValue(codeNames.map((name, index) => codeDefinition(`code-${index}`, name)))
    mockEm.count.mockResolvedValue(definitions.length)
    mockEm.find.mockImplementation(async (
      _entity: unknown,
      _where: unknown,
      options: { fields?: string[]; limit: number; offset?: number },
    ) => options.fields ? [] : definitions.slice(options.offset ?? 0, (options.offset ?? 0) + options.limit))

    const response = await listDefinitions(new NextRequest(`http://localhost/api/workflows/definitions?limit=3&offset=${offset}`))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.map((row: { workflowName: string }) => row.workflowName)).toEqual(expectedNames.slice(offset, offset + 3))
    expect(body.pagination).toEqual({ total: 14, limit: 3, offset, hasMore: offset + 3 < 14 })
  })

  test('definitions use bounded shadow checks and retain the database override in merged pages', async () => {
    const shadowedCode = codeDefinition('overridden', 'Before')
    const visibleCode = codeDefinition('code-visible', 'Workflow 000001.5')
    const override = { ...databaseDefinition(1), workflowId: shadowedCode.workflowId, codeWorkflowId: shadowedCode.workflowId }
    const definitions = [databaseDefinition(0), override, databaseDefinition(2)]
    mockGetAllCodeWorkflows.mockReturnValue([shadowedCode, visibleCode])
    mockEm.count.mockResolvedValue(3)
    mockEm.find.mockImplementation(async (
      _entity: unknown,
      where: { workflowId?: string },
      options: { fields?: string[]; limit: number; offset?: number },
    ) => {
      if (options.fields) return where.workflowId === shadowedCode.workflowId ? [{ workflowId: shadowedCode.workflowId }] : []
      return definitions.slice(options.offset ?? 0, (options.offset ?? 0) + options.limit)
    })

    const response = await listDefinitions(new NextRequest('http://localhost/api/workflows/definitions?limit=2&offset=1'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.map((row: { id: string }) => row.id)).toEqual([override.id, 'code:code-visible'])
    expect(body.pagination.total).toBe(4)
    for (const code of [shadowedCode, visibleCode]) {
      expect(mockEm.find).toHaveBeenCalledWith(
        WorkflowDefinition,
        expect.objectContaining({ ...scopedWhere, deletedAt: null, workflowId: code.workflowId }),
        expect.objectContaining({ fields: ['workflowId'], limit: 1 }),
      )
    }
    expect(mockEm.find).toHaveBeenCalledWith(
      WorkflowDefinition, expect.objectContaining(scopedWhere), expect.objectContaining({ limit: 3, offset: 0 }),
    )
  })

  test('definitions return an empty page beyond the merged total without fetching database definitions', async () => {
    mockEm.count.mockResolvedValue(5)

    const response = await listDefinitions(new NextRequest('http://localhost/api/workflows/definitions?limit=2&offset=100000'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: [], pagination: { total: 5, limit: 2, offset: 100000, hasMore: false } })
    expect(mockEm.find).not.toHaveBeenCalled()
  })
})
