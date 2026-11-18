/** @jest-environment node */
import { GET, POST, PUT, DELETE } from '@open-mercato/core/modules/entities/api/records'

const mockQE = {
  query: jest.fn(async (_entityId: string, _options: Record<string, unknown>) => ({ items: [], total: 0, page: 1, pageSize: 50 })),
}

const storageRows = { custom: false }

const mockKysely = {
  selectFrom: () => mockKysely,
  select: () => mockKysely,
  where: () => mockKysely,
  limit: () => mockKysely,
  executeTakeFirst: async () => (storageRows.custom ? { entity_id: 'rec-1' } : null),
  execute: async () => [],
}

const customEntityRow = { value: null as null | { id: string } }

type Registration = {
  entityId: string
  tenantId: string | null
  organizationId: string | null
  accessRestricted: boolean
}

const registrations: Registration[] = []

function matchesRegistration(row: Registration, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === '$or') return (value as Record<string, unknown>[]).some((candidate) => matchesRegistration(row, candidate))
    return ({ isActive: true, deletedAt: null, ...row } as Record<string, unknown>)[key] === value
  })
}

const mockEm = {
  findOne: jest.fn(async (_entity: unknown, where: Record<string, unknown>) => (
    registrations.find((row) => matchesRegistration(row, where)) ?? customEntityRow.value
  )),
  find: jest.fn(async () => [] as Array<Record<string, unknown>>),
  getKysely: () => mockKysely,
}

const mockDataEngine = {
  createCustomEntityRecord: jest.fn(async () => ({ id: 'rec-001' })),
  updateCustomEntityRecord: jest.fn(async () => undefined),
  deleteCustomEntityRecord: jest.fn(async () => undefined),
}

const aclState: { isSuperAdmin: boolean; features: string[] } = { isSuperAdmin: false, features: [] }

const mockRbac = {
  loadAcl: jest.fn(async () => ({ isSuperAdmin: aclState.isSuperAdmin, features: aclState.features })),
  userHasAllFeatures: jest.fn(async (_userId: string, required: readonly string[]) => (
    aclState.isSuperAdmin || required.every((feature) => aclState.features.includes(feature))
  )),
  resolveVisibleOrganizations: jest.fn(async () => ['org']),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (k: string) => {
      if (k === 'queryEngine') return mockQE
      if (k === 'em') return mockEm
      if (k === 'rbacService') return mockRbac
      return mockDataEngine
    },
  }),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: () => ({ sub: 'u1', orgId: 'org', tenantId: 't1', roles: ['admin'] }),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScope: async ({ selectedId }: { selectedId: string }) => ({
    selectedId: selectedId === '__all__' ? null : selectedId,
    filterIds: selectedId === '__all__' ? null : [selectedId],
  }),
  getSelectedOrganizationFromRequest: (req: Request) => req.headers.get('cookie')?.split('=')[1] ?? 'org',
}))

const VALID_UUID = '123e4567-e89b-12d3-a456-426614174000'

function getReq(entityId: string, extra = ''): Request {
  return new Request(`http://x/api/entities/records?entityId=${encodeURIComponent(entityId)}${extra}`)
}

function postReq(entityId: string): Request {
  return new Request('http://x/api/entities/records', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ entityId, values: {} }),
  })
}

function putReq(entityId: string): Request {
  return new Request('http://x/api/entities/records', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ entityId, recordId: VALID_UUID, values: {} }),
  })
}

function deleteReq(entityId: string): Request {
  return new Request(`http://x/api/entities/records?entityId=${encodeURIComponent(entityId)}&recordId=${VALID_UUID}`, {
    method: 'DELETE',
  })
}

describe('Records API entity ACL gating', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    aclState.isSuperAdmin = false
    aclState.features = []
    storageRows.custom = false
    customEntityRow.value = null
    registrations.length = 0
  })

  describe('platformOnly entity (directory:tenant) for non-superadmin', () => {
    it('denies GET with 403 even when the mapped feature is granted', async () => {
      aclState.features = ['directory.tenants.view', 'directory.tenants.manage']
      const res = await GET(getReq('directory:tenant'))
      expect(res.status).toBe(403)
      expect(mockQE.query).not.toHaveBeenCalled()
    })

    it('denies export (?format=csv) with 403', async () => {
      aclState.features = ['directory.tenants.view']
      const res = await GET(getReq('directory:tenant', '&format=csv'))
      expect(res.status).toBe(403)
      expect(mockQE.query).not.toHaveBeenCalled()
    })

    it('denies POST with 403', async () => {
      aclState.features = ['directory.tenants.manage']
      const res = await POST(postReq('directory:tenant'))
      expect(res.status).toBe(403)
      expect(mockDataEngine.createCustomEntityRecord).not.toHaveBeenCalled()
    })

    it('denies PUT with 403', async () => {
      aclState.features = ['directory.tenants.manage']
      const res = await PUT(putReq('directory:tenant'))
      expect(res.status).toBe(403)
      expect(mockDataEngine.updateCustomEntityRecord).not.toHaveBeenCalled()
    })

    it('denies DELETE with 403', async () => {
      aclState.features = ['directory.tenants.manage']
      const res = await DELETE(deleteReq('directory:tenant'))
      expect(res.status).toBe(403)
      expect(mockDataEngine.deleteCustomEntityRecord).not.toHaveBeenCalled()
    })
  })

  it('denies GET with 403 when caller holds entities.records.view but lacks the mapped target feature', async () => {
    aclState.features = ['entities.records.view']
    const res = await GET(getReq('customers:customer_person_profile'))
    expect(res.status).toBe(403)
    expect(mockQE.query).not.toHaveBeenCalled()
  })

  it('denies GET with 403 for an unmapped non-custom entity (non-superadmin)', async () => {
    aclState.features = ['entities.records.view', 'foo.bar']
    const res = await GET(getReq('foo:bar'))
    expect(res.status).toBe(403)
    expect(mockQE.query).not.toHaveBeenCalled()
  })

  it('does not block a custom entity GET (reaches the query)', async () => {
    customEntityRow.value = { id: 'ce-1' }
    aclState.features = ['entities.records.view']
    const res = await GET(getReq('example:custom'))
    expect(res.status).toBe(200)
    expect(mockQE.query).toHaveBeenCalled()
    expect(mockRbac.loadAcl).not.toHaveBeenCalled()
  })

  describe('restricted registrations in another organization', () => {
    beforeEach(() => {
      registrations.push(
        { entityId: 'user:salaries', tenantId: 't1', organizationId: 'hq', accessRestricted: true },
        { entityId: 'user:salaries', tenantId: 't1', organizationId: 'org', accessRestricted: false },
      )
      aclState.features = ['entities.records.view', 'entities.records.manage']
    })

    it.each(['org', 'hq', '__all__'])('denies read and CSV export when selecting %s without the per-entity grant', async (selectedOrg) => {
      for (const suffix of ['', '&format=csv']) {
        const req = new Request(getReq('user:salaries', suffix), {
          headers: { cookie: `om_selected_org=${selectedOrg}` },
        })
        const res = await GET(req)
        expect(res.status).toBe(403)
      }
      expect(mockQE.query).not.toHaveBeenCalled()
    })

    it('denies create, update and delete in the caller organization without the per-entity manage grant', async () => {
      aclState.features.push('entities.records.user:salaries.view')

      expect((await POST(postReq('user:salaries'))).status).toBe(403)
      expect((await PUT(putReq('user:salaries'))).status).toBe(403)
      expect((await DELETE(deleteReq('user:salaries'))).status).toBe(403)
      expect(mockDataEngine.createCustomEntityRecord).not.toHaveBeenCalled()
      expect(mockDataEngine.updateCustomEntityRecord).not.toHaveBeenCalled()
      expect(mockDataEngine.deleteCustomEntityRecord).not.toHaveBeenCalled()
    })

    it('allows a caller with the per-entity view feature and preserves all-organization query scope', async () => {
      aclState.features.push('entities.records.user:salaries.view')
      const req = new Request(getReq('user:salaries'), { headers: { cookie: 'om_selected_org=__all__' } })

      expect((await GET(req)).status).toBe(200)
      expect(mockQE.query).toHaveBeenCalledWith('user:salaries', expect.objectContaining({ tenantId: 't1', filters: {} }))
      expect(mockQE.query.mock.calls[0]?.[1]).not.toHaveProperty('organizationIds')
    })

    it('preserves superadmin access through the existing RBAC service', async () => {
      aclState.isSuperAdmin = true

      expect((await GET(getReq('user:salaries'))).status).toBe(200)
      expect(mockRbac.userHasAllFeatures).toHaveBeenCalledWith('u1', ['entities.records.user:salaries.view'], { tenantId: 't1', organizationId: 'org' })
      expect(mockQE.query).toHaveBeenCalled()
    })
  })

  it('cannot use a foreign tenant registration to allow a custom record read', async () => {
    registrations.push({ entityId: 'user:salaries', tenantId: 'other-tenant', organizationId: 'org', accessRestricted: false })
    aclState.features = ['entities.records.view']

    expect((await GET(getReq('user:salaries'))).status).toBe(403)
    expect(mockQE.query).not.toHaveBeenCalled()
    expect(mockEm.findOne).not.toHaveBeenCalledWith(expect.anything(), { entityId: 'user:salaries' })
  })

  it('allows a superadmin GET for directory:tenant (reaches the query)', async () => {
    aclState.isSuperAdmin = true
    const res = await GET(getReq('directory:tenant'))
    expect(res.status).toBe(200)
    expect(mockQE.query).toHaveBeenCalled()
  })
})
