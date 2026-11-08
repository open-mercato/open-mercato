/** @jest-environment node */

// `GET /api/attachments/library` keeps owners declared `listInLibrary: false` out of its
// candidate queries. The query builder below is an in-memory stand-in that evaluates the
// MikroORM filter objects the route hands it, so the tests can assert both the filter shape
// (`entity_id not in (…)` in the records, count and facet queries) and that excluded rows never
// reach an owner-access resolver, however many there are. This stands in for the spec's
// 100 000-row benchmark: the exclusion is a predicate of the SQL candidate query, so excluded rows
// cost neither a fetch nor a resolver call.

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1', roles: [] })),
}))
jest.mock('@open-mercato/core/modules/attachments/data/entities', () => ({
  Attachment: class Attachment {},
  AttachmentPartition: class AttachmentPartition {},
}))
jest.mock('@open-mercato/core/modules/attachments/lib/partitions', () => ({
  ensureDefaultPartitions: jest.fn(async () => undefined),
}))
jest.mock('@open-mercato/core/modules/attachments/lib/assignmentDetails', () => ({
  resolveAssignmentEnrichments: jest.fn(async () => new Map()),
  applyAssignmentEnrichments: jest.fn((assignments: unknown) => assignments),
}))

type Row = {
  id: string
  entityId: string
  recordId: string
  tenantId: string
  organizationId: string
  partitionCode: string
  fileName: string
  mimeType: string
  fileSize: number
  url: string
  createdAt: Date
  storageMetadata: Record<string, unknown>
  content: string | null
}

type Filter = Record<string, unknown>

const mockState: {
  rows: Row[]
  partitions: Array<Record<string, unknown>>
  filters: Filter[][]
  tagQueryWheres: unknown[][]
} = { rows: [], partitions: [], filters: [], tagQueryWheres: [] }

function matches(row: Row, filter: Filter): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    const actual = (row as unknown as Record<string, unknown>)[key]
    if (expected && typeof expected === 'object' && '$nin' in expected) {
      return !(expected as { $nin: unknown[] }).$nin.includes(actual)
    }
    return actual === expected
  })
}

class FakeQueryBuilder {
  constructor(private conditions: Filter[] = [], private max?: number, private skip = 0) {
    mockState.filters.push(this.conditions)
  }
  where(filter: Filter) { this.conditions.push(filter); return this }
  andWhere(filter: Filter) { this.conditions.push(filter); return this }
  orderBy() { return this }
  limit(value: number) { this.max = value; return this }
  offset(value: number) { this.skip = value; return this }
  clone() { return new FakeQueryBuilder([...this.conditions], this.max, this.skip) }
  private filtered() { return mockState.rows.filter((row) => this.conditions.every((filter) => matches(row, filter))) }
  async getResultList() {
    const rows = this.filtered().sort((left, right) => (left.id < right.id ? -1 : 1))
    return rows.slice(this.skip, this.max === undefined ? undefined : this.skip + this.max)
  }
  async getCount() { return this.filtered().length }
}

function makeTagQuery(wheres: unknown[][] = []) {
  const query = {
    select: () => query,
    where: (...args: unknown[]) => { wheres.push(args); return query },
    orderBy: () => query,
    execute: async () => [],
  }
  mockState.tagQueryWheres = wheres
  return query
}

const mockEm = {
  createQueryBuilder: jest.fn(() => new FakeQueryBuilder()),
  find: jest.fn(async () => mockState.partitions),
  getKysely: () => ({ selectFrom: () => makeTagQuery() }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (key: string) => {
      if (key === 'em') return mockEm
      if (key === 'rbacService') {
        return {
          loadAcl: async () => ({ isSuperAdmin: false, organizations: null }),
          getEffectiveFeatures: async () => ['inbox_ops.proposals.view', 'documents.view'],
        }
      }
      throw new Error(`unregistered ${key}`)
    },
  })),
}))

import { GET } from '../library/route'
import { registerAttachmentAccessResolvers } from '../../lib/access-registry'
import type { AttachmentAccessDecision, AttachmentAccessInput } from '../../lib/access-types'

const resolveDocument = jest.fn(async (_input: AttachmentAccessInput): Promise<AttachmentAccessDecision> => ({ ok: true }))
const resolveInbox = jest.fn(async (_input: AttachmentAccessInput): Promise<AttachmentAccessDecision> => ({ ok: true }))

function row(id: string, entityId: string, tags: string[] = []): Row {
  return {
    id, entityId, recordId: `${entityId}-record`, tenantId: 'tenant-1', organizationId: 'org-1',
    partitionCode: 'privateAttachments', fileName: `${id}.pdf`, mimeType: 'application/pdf', fileSize: 1,
    url: `/api/attachments/file/${id}`, createdAt: new Date('2026-11-01T00:00:00Z'),
    storageMetadata: { tags, assignments: [{ type: entityId, id: `${entityId}-record` }] }, content: null,
  }
}

function seed(excludedCount: number) {
  mockState.rows = [
    row('a-doc-1', 'documents:document', ['contract']),
    row('a-doc-2', 'documents:document'),
    ...Array.from({ length: excludedCount }, (_unused, index) => row(`b-mail-${String(index).padStart(5, '0')}`, 'inbox_ops:inbox_email', ['secret'])),
  ]
}

function registerOwners(options: { inbox: boolean }) {
  registerAttachmentAccessResolvers([
    {
      moduleId: 'documents',
      resolvers: [{ id: 'documents.files', targetPartition: '*', targetEntity: 'documents:document', resolve: resolveDocument }],
      protectedTargets: [{ resolverId: 'documents.files', targetPartition: '*', targetEntity: 'documents:document' }],
    },
    ...(options.inbox ? [{
      moduleId: 'inbox_ops',
      resolvers: [{ id: 'inbox_ops.email-attachments', targetPartition: '*', targetEntity: 'inbox_ops:inbox_email', resolve: resolveInbox }],
      protectedTargets: [{
        resolverId: 'inbox_ops.email-attachments', targetPartition: '*', targetEntity: 'inbox_ops:inbox_email', listInLibrary: false,
      }],
    }] : []),
  ])
}

async function listLibrary(search = '') {
  const response = await GET(new Request(`http://localhost/api/attachments/library${search}`))
  return { status: response.status, body: await response.json() as { items: Array<{ id: string }>; total: number; availableTags: string[] } }
}

function expectEveryQueryExcludesInbox() {
  // Records page, count (a clone of it) and the facet query each carry the exclusion.
  const queries = mockState.filters.filter((conditions) => conditions.length > 0)
  expect(queries.length).toBeGreaterThanOrEqual(3)
  for (const conditions of queries) {
    expect(conditions).toContainEqual(expect.objectContaining({
      tenantId: 'tenant-1', organizationId: 'org-1', entityId: { $nin: ['inbox_ops:inbox_email'] },
    }))
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockState.filters = []
  mockState.tagQueryWheres = []
  mockState.partitions = [{
    code: 'privateAttachments', title: 'Private', isPublic: false, tenantId: null, organizationId: null,
    accessResolverRequirements: [
      { resolverId: 'documents.files', targetEntity: 'documents:document' },
      { resolverId: 'inbox_ops.email-attachments', targetEntity: 'inbox_ops:inbox_email' },
    ],
    libraryExcludedEntities: null,
  }]
})
afterEach(() => registerAttachmentAccessResolvers([]))

describe('attachments library exclusion of listInLibrary: false owners', () => {
  it('excludes the owner in the records, count and facet queries before any resolver runs', async () => {
    registerOwners({ inbox: true })
    seed(5)
    const { status, body } = await listLibrary()
    expect(status).toBe(200)
    expect(body.items.map((item) => item.id)).toEqual(['a-doc-1', 'a-doc-2'])
    expect(body.total).toBe(2)
    expect(body.availableTags).toEqual(['contract'])
    expectEveryQueryExcludesInbox()
    expect(resolveInbox).not.toHaveBeenCalled()
  })

  it('costs the same resolver work with 10 000 excluded rows as with none, facets included', async () => {
    registerOwners({ inbox: true })
    seed(0)
    await listLibrary()
    const baseline = resolveDocument.mock.calls.length
    jest.clearAllMocks()
    seed(10_000)
    const { body } = await listLibrary()
    expect(body.total).toBe(2)
    expect(resolveDocument).toHaveBeenCalledTimes(baseline)
    expect(resolveInbox).not.toHaveBeenCalled()
  })

  it('keeps excluding the owner after its module is disabled, through the partition column', async () => {
    registerOwners({ inbox: false })
    mockState.partitions[0].libraryExcludedEntities = ['inbox_ops:inbox_email']
    seed(3)
    const { status, body } = await listLibrary()
    expect(status).toBe(200)
    expect(body.items.map((item) => item.id)).toEqual(['a-doc-1', 'a-doc-2'])
    expect(body.total).toBe(2)
    expectEveryQueryExcludesInbox()
  })

  it('applies the exclusion to the unprotected path and its tag facet query too', async () => {
    registerAttachmentAccessResolvers([])
    mockState.partitions = [{
      code: 'privateAttachments', title: 'Private', isPublic: false,
      accessResolverRequirements: [], libraryExcludedEntities: ['inbox_ops:inbox_email'],
    }]
    seed(3)
    const { body } = await listLibrary()
    expect(body.items.map((item) => item.id)).toEqual(['a-doc-1', 'a-doc-2'])
    expect(body.total).toBe(2)
    expect(mockState.tagQueryWheres).toContainEqual(['entity_id', 'not in', ['inbox_ops:inbox_email']])
  })

  it('leaves the candidate queries unchanged when no owner is excluded', async () => {
    registerOwners({ inbox: false })
    mockState.partitions[0].accessResolverRequirements = [{ resolverId: 'documents.files', targetEntity: 'documents:document' }]
    seed(2)
    const { body } = await listLibrary()
    expect(body.total).toBe(4)
    for (const conditions of mockState.filters) {
      for (const filter of conditions) expect(filter).not.toHaveProperty('entityId')
    }
  })
})
