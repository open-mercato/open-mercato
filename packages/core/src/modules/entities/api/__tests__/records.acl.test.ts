/** @jest-environment node */
import { GET, POST, PUT, DELETE } from '@open-mercato/core/modules/entities/api/records'

const mockQE = {
  query: jest.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 50 })),
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

const mockEm = {
  findOne: jest.fn(async () => customEntityRow.value),
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
  resolveOrganizationScope: async () => ({ selectedId: 'org', filterIds: ['org'] }),
  getSelectedOrganizationFromRequest: () => 'org',
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

  it('allows a superadmin GET for directory:tenant (reaches the query)', async () => {
    aclState.isSuperAdmin = true
    const res = await GET(getReq('directory:tenant'))
    expect(res.status).toBe(200)
    expect(mockQE.query).toHaveBeenCalled()
  })
})
