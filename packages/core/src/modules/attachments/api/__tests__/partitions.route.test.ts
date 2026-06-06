/** @jest-environment node */
// Regression coverage for finding #2 in report-high.md: cross-tenant
// write/delete of `AttachmentPartition` via the `attachments.manage` feature.

jest.mock('#generated/entities.ids.generated', () => ({
  E: {
    attachments: { attachment: 'attachments:attachment' },
  },
}))

// Avoid loading MikroORM decorators in tests
jest.mock('@open-mercato/core/modules/attachments/data/entities', () => ({
  Attachment: class Attachment {},
  AttachmentPartition: class AttachmentPartition {},
}))

jest.mock('@open-mercato/core/modules/attachments/lib/partitions', () => ({
  DEFAULT_ATTACHMENT_PARTITIONS: [
    { code: 'privateAttachments' },
    { code: 'productsMedia' },
  ],
  ensureDefaultPartitions: jest.fn(async () => {}),
  sanitizePartitionCode: (input: unknown) =>
    typeof input === 'string' ? input.trim() : null,
  isPartitionSettingsLocked: () => false,
}))

jest.mock('@open-mercato/core/modules/attachments/lib/partitionEnv', () => ({
  resolvePartitionEnvKey: (_code: string) => null,
}))

jest.mock('@open-mercato/core/modules/attachments/lib/ocrConfig', () => ({
  resolveDefaultAttachmentOcrEnabled: () => true,
}))

type AuthFixture = {
  sub?: string
  tenantId?: string | null
  orgId?: string | null
  isSuperAdmin?: boolean
}

let currentAuth: AuthFixture | null = { sub: 'u1', tenantId: 'tenantA', orgId: 'orgA' }

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => currentAuth),
}))

type PartitionRow = {
  id: string
  code: string
  title: string
  description?: string | null
  storageDriver: string
  configJson?: Record<string, unknown> | null
  isPublic: boolean
  requiresOcr: boolean
  ocrModel?: string | null
  tenantId: string | null
  organizationId: string | null
  createdAt: Date
  updatedAt: Date
}

type AttachmentRow = {
  partitionCode: string
  tenantId: string | null
}

const store: { partitions: PartitionRow[]; attachments: AttachmentRow[] } = {
  partitions: [],
  attachments: [],
}

function matchesFilter(row: PartitionRow, filter: any): boolean {
  if (!filter) return true
  if (filter.$or && Array.isArray(filter.$or)) {
    return filter.$or.some((part: any) => matchesFilter(row, part))
  }
  for (const key of Object.keys(filter)) {
    const expected = filter[key]
    const actual = (row as any)[key]
    if (expected === null) {
      if (actual !== null && actual !== undefined) return false
    } else if (actual !== expected) {
      return false
    }
  }
  return true
}

const mockEm = {
  find: jest.fn(async (_cls: any, filter: any) =>
    store.partitions.filter((row) => matchesFilter(row, filter)),
  ),
  findOne: jest.fn(async (entity: any, filter: any) => {
    const name = typeof entity?.name === 'string' ? entity.name : ''
    if (name === 'AttachmentPartition' || entity === undefined) {
      if (filter?.id) {
        return store.partitions.find((row) => row.id === filter.id) ?? null
      }
      if (filter?.code) {
        return store.partitions.find((row) => row.code === filter.code) ?? null
      }
    }
    return null
  }),
  count: jest.fn(async (_cls: any, filter: any) =>
    store.attachments.filter((row) => {
      if (filter?.partitionCode && row.partitionCode !== filter.partitionCode) return false
      if (Object.prototype.hasOwnProperty.call(filter ?? {}, 'tenantId')) {
        if (filter.tenantId !== row.tenantId) return false
      }
      return true
    }).length,
  ),
  create: jest.fn((_cls: any, data: any) => {
    const row: PartitionRow = {
      id: data.id ?? `p-${store.partitions.length + 1}`,
      code: data.code,
      title: data.title,
      description: data.description ?? null,
      storageDriver: data.storageDriver ?? 'local',
      configJson: data.configJson ?? null,
      isPublic: data.isPublic ?? false,
      requiresOcr: data.requiresOcr ?? true,
      ocrModel: data.ocrModel ?? null,
      tenantId: data.tenantId ?? null,
      organizationId: data.organizationId ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    store.partitions.push(row)
    return row
  }),
  persist: jest.fn(function persist(this: any) {
    return this
  }),
  remove: jest.fn(function remove(this: any, row: PartitionRow) {
    store.partitions = store.partitions.filter((existing) => existing.id !== row.id)
    return this
  }),
  flush: jest.fn(async () => {}),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (k: string) => (k === 'em' ? mockEm : null),
  }),
}))

function buildRequest(method: string, body: any, search: string = ''): Request {
  const url = `http://test.local/api/attachments/partitions${search}`
  if (method === 'GET' || method === 'DELETE') {
    return new Request(url, { method })
  }
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
}

async function loadHandlers() {
  return import('@open-mercato/core/modules/attachments/api/partitions/route')
}

function resetStore() {
  store.partitions = [
    {
      id: '11111111-1111-4111-8111-111111111111',
      code: 'privateAttachments',
      title: 'Platform Private',
      storageDriver: 'local',
      isPublic: false,
      requiresOcr: true,
      tenantId: null,
      organizationId: null,
      createdAt: new Date('2025-01-01'),
      updatedAt: new Date('2025-01-01'),
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      code: 'tenantAPriv',
      title: 'Tenant A Private',
      storageDriver: 'local',
      isPublic: false,
      requiresOcr: true,
      tenantId: 'tenantA',
      organizationId: 'orgA',
      createdAt: new Date('2025-02-01'),
      updatedAt: new Date('2025-02-01'),
    },
    {
      id: '33333333-3333-4333-8333-333333333333',
      code: 'tenantBPriv',
      title: 'Tenant B Private',
      storageDriver: 'local',
      isPublic: false,
      requiresOcr: true,
      tenantId: 'tenantB',
      organizationId: 'orgB',
      createdAt: new Date('2025-03-01'),
      updatedAt: new Date('2025-03-01'),
    },
  ]
  store.attachments = []
}

describe('attachment partitions API — tenant scoping', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetStore()
    currentAuth = { sub: 'u1', tenantId: 'tenantA', orgId: 'orgA' }
  })

  it('GET returns platform defaults + own-tenant partitions only', async () => {
    const { GET } = await loadHandlers()
    const res = await GET(buildRequest('GET', null))
    expect(res.status).toBe(200)
    const body = await res.json()
    const codes = body.items.map((it: any) => it.code).sort()
    expect(codes).toEqual(['privateAttachments', 'tenantAPriv'])
  })

  it('GET as superadmin returns every partition', async () => {
    currentAuth = { sub: 'root', tenantId: 'tenantA', orgId: 'orgA', isSuperAdmin: true }
    const { GET } = await loadHandlers()
    const res = await GET(buildRequest('GET', null))
    expect(res.status).toBe(200)
    const body = await res.json()
    const codes = body.items.map((it: any) => it.code).sort()
    expect(codes).toEqual(['privateAttachments', 'tenantAPriv', 'tenantBPriv'])
  })

  it('PUT cross-tenant returns 404 and does not mutate the foreign row', async () => {
    const { PUT } = await loadHandlers()
    const res = await PUT(
      buildRequest('PUT', {
        id: '33333333-3333-4333-8333-333333333333',
        code: 'tenantBPriv',
        title: 'Hijacked',
        isPublic: true,
      }),
    )
    expect(res.status).toBe(404)
    expect(mockEm.flush).not.toHaveBeenCalled()
    const row = store.partitions.find((p) => p.id === '33333333-3333-4333-8333-333333333333')!
    expect(row.title).toBe('Tenant B Private')
    expect(row.isPublic).toBe(false)
  })

  it('PUT on platform default as a tenant admin returns 404', async () => {
    const { PUT } = await loadHandlers()
    const res = await PUT(
      buildRequest('PUT', {
        id: '11111111-1111-4111-8111-111111111111',
        code: 'privateAttachments',
        title: 'Hijacked Default',
      }),
    )
    expect(res.status).toBe(404)
    expect(mockEm.flush).not.toHaveBeenCalled()
    const row = store.partitions.find((p) => p.id === '11111111-1111-4111-8111-111111111111')!
    expect(row.title).toBe('Platform Private')
  })

  it('PUT on platform default as superadmin succeeds', async () => {
    currentAuth = { sub: 'root', tenantId: 'tenantA', orgId: 'orgA', isSuperAdmin: true }
    const { PUT } = await loadHandlers()
    const res = await PUT(
      buildRequest('PUT', {
        id: '11111111-1111-4111-8111-111111111111',
        code: 'privateAttachments',
        title: 'Updated Default',
      }),
    )
    expect(res.status).toBe(200)
    const row = store.partitions.find((p) => p.id === '11111111-1111-4111-8111-111111111111')!
    expect(row.title).toBe('Updated Default')
  })

  it('PUT on own partition succeeds', async () => {
    const { PUT } = await loadHandlers()
    const res = await PUT(
      buildRequest('PUT', {
        id: '22222222-2222-4222-8222-222222222222',
        code: 'tenantAPriv',
        title: 'Renamed',
        isPublic: false,
      }),
    )
    expect(res.status).toBe(200)
    const row = store.partitions.find((p) => p.id === '22222222-2222-4222-8222-222222222222')!
    expect(row.title).toBe('Renamed')
  })

  it('DELETE cross-tenant returns 404 and leaves the foreign row in place', async () => {
    const { DELETE: del } = await loadHandlers()
    const res = await del(buildRequest('DELETE', null, '?id=33333333-3333-4333-8333-333333333333'))
    expect(res.status).toBe(404)
    expect(store.partitions.some((p) => p.id === '33333333-3333-4333-8333-333333333333')).toBe(true)
    expect(mockEm.remove).not.toHaveBeenCalled()
  })

  it('DELETE on own non-default partition succeeds when unused', async () => {
    const { DELETE: del } = await loadHandlers()
    const res = await del(buildRequest('DELETE', null, '?id=22222222-2222-4222-8222-222222222222'))
    expect(res.status).toBe(200)
    expect(store.partitions.some((p) => p.id === '22222222-2222-4222-8222-222222222222')).toBe(false)
  })

  it('DELETE in-use check is scoped to the partition tenant', async () => {
    store.attachments.push({ partitionCode: 'tenantAPriv', tenantId: 'tenantB' })
    const { DELETE: del } = await loadHandlers()
    const res = await del(buildRequest('DELETE', null, '?id=22222222-2222-4222-8222-222222222222'))
    expect(res.status).toBe(200)
    expect(mockEm.count).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ partitionCode: 'tenantAPriv', tenantId: 'tenantA' }),
    )
  })

  it('DELETE on default partition is still rejected even for own tenant', async () => {
    // Patch the seeded platform default to be tenant-owned to simulate
    // attempting deletion of a default code by tenant.
    const seeded = store.partitions.find((p) => p.id === '11111111-1111-4111-8111-111111111111')!
    seeded.tenantId = 'tenantA'
    const { DELETE: del } = await loadHandlers()
    const res = await del(buildRequest('DELETE', null, '?id=11111111-1111-4111-8111-111111111111'))
    expect(res.status).toBe(400)
    expect(mockEm.remove).not.toHaveBeenCalled()
  })

  it('POST stamps tenant scope on insert', async () => {
    const { POST } = await loadHandlers()
    const res = await POST(
      buildRequest('POST', {
        code: 'customA',
        title: 'Custom A',
        storageDriver: 'local',
        isPublic: false,
      }),
    )
    expect(res.status).toBe(201)
    const row = store.partitions.find((p) => p.code === 'customA')!
    expect(row.tenantId).toBe('tenantA')
    expect(row.organizationId).toBe('orgA')
  })

  it('Unauthenticated requests are rejected on every verb', async () => {
    currentAuth = null
    const { GET, POST, PUT, DELETE: del } = await loadHandlers()
    const r1 = await GET(buildRequest('GET', null))
    const r2 = await POST(buildRequest('POST', { code: 'c1', title: 't', storageDriver: 'local' }))
    const r3 = await PUT(buildRequest('PUT', { id: '22222222-2222-4222-8222-222222222222', code: 'tenantAPriv', title: 'x' }))
    const r4 = await del(buildRequest('DELETE', null, '?id=22222222-2222-4222-8222-222222222222'))
    for (const r of [r1, r2, r3, r4]) expect(r.status).toBe(401)
  })

  it('Requests without tenantId are rejected even with a sub', async () => {
    currentAuth = { sub: 'u1', tenantId: null }
    const { PUT } = await loadHandlers()
    const res = await PUT(
      buildRequest('PUT', { id: '22222222-2222-4222-8222-222222222222', code: 'tenantAPriv', title: 'x' }),
    )
    expect(res.status).toBe(401)
  })
})
