/** @jest-environment node */
import { GET, POST, PUT, DELETE } from '@open-mercato/core/modules/entities/api/records'
import { UNKNOWN_CUSTOM_FIELD_ERROR } from '@open-mercato/shared/modules/entities/validation'

let mockRecordUpdatedAt: string | null = null

function makeKyselyStub() {
  const builder: any = {
    select: () => builder,
    where: () => builder,
    executeTakeFirst: async () => (mockRecordUpdatedAt == null ? undefined : { updated_at: mockRecordUpdatedAt }),
  }
  return { selectFrom: () => builder }
}

const mockEm = {
  find: jest.fn(async () => [] as Array<Record<string, unknown>>),
  findOne: jest.fn(async () => null),
  getKysely: jest.fn(() => makeKyselyStub()),
}

function mockActiveCustomFieldDefs(keys: string[]) {
  return keys.map((key) => ({
    key,
    kind: 'text',
    isActive: true,
    deletedAt: null,
    organizationId: 'org',
    tenantId: 't1',
    updatedAt: new Date('2026-03-31T00:00:00.000Z'),
    configJson: {},
  }))
}

function mockCustomFieldDefsLookup(keys: string[]) {
  mockEm.find.mockResolvedValueOnce(mockActiveCustomFieldDefs(keys))
}

const mockDataEngine = {
  createCustomEntityRecord: jest.fn(async () => ({ id: 'rec-001' })),
  updateCustomEntityRecord: jest.fn(async () => undefined),
  deleteCustomEntityRecord: jest.fn(async () => undefined),
}

const mockQueryEngine = {
  query: jest.fn(async () => ({ items: [], total: 0 })),
}

const mockRbac = {
  resolveVisibleOrganizations: jest.fn(async () => ['org']),
  loadAcl: jest.fn(async () => ({ isSuperAdmin: true, features: [], organizations: null })),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (k: string) => {
      if (k === 'em') return mockEm
      if (k === 'rbacService') return mockRbac
      if (k === 'queryEngine') return mockQueryEngine
      return mockDataEngine
    },
  }),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: () => ({ orgId: 'org', tenantId: 't1', roles: ['admin'] }),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScope: async () => ({ selectedId: 'org', filterIds: ['org'] }),
  getSelectedOrganizationFromRequest: () => 'org',
}))

describe('Records API CRUD operations', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRecordUpdatedAt = null
  })

  describe('POST /api/entities/records', () => {
    it('creates a record and returns entityId + recordId', async () => {
      mockCustomFieldDefsLookup(['location', 'title'])
      const req = new Request('http://x/api/entities/records', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          entityId: 'user:qa_entity',
          values: { location: 'Berlin', title: 'Conference' },
        }),
      })
      const res = await POST(req)
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.ok).toBe(true)
      expect(json.item).toMatchObject({ entityId: 'user:qa_entity', recordId: 'rec-001' })
      expect(mockDataEngine.createCustomEntityRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          entityId: 'user:qa_entity',
          tenantId: 't1',
          organizationId: 'org',
          values: { location: 'Berlin', title: 'Conference' },
        }),
      )
    })

    it('strips cf_ prefix from value keys', async () => {
      mockCustomFieldDefsLookup(['location', 'title'])
      const req = new Request('http://x/api/entities/records', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          entityId: 'user:qa_entity',
          values: { cf_location: 'Warsaw', cf_title: 'Meetup' },
        }),
      })
      const res = await POST(req)
      expect(res.status).toBe(200)
      expect(mockDataEngine.createCustomEntityRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          values: { location: 'Warsaw', title: 'Meetup' },
        }),
      )
    })

    it('rejects undeclared custom field keys with 400', async () => {
      mockCustomFieldDefsLookup(['title'])
      const req = new Request('http://x/api/entities/records', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          entityId: 'user:qa_entity',
          values: { title: 'Allowed', undeclared: 'injected' },
        }),
      })
      const res = await POST(req)
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.fields.cf_undeclared).toBe(UNKNOWN_CUSTOM_FIELD_ERROR)
      expect(mockDataEngine.createCustomEntityRecord).not.toHaveBeenCalled()
    })

    it('rejects missing entityId with 400', async () => {
      const req = new Request('http://x/api/entities/records', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ values: { title: 'oops' } }),
      })
      const res = await POST(req)
      expect(res.status).toBe(400)
    })

    it('ignores non-UUID recordId and lets data engine generate one', async () => {
      mockCustomFieldDefsLookup(['title'])
      const req = new Request('http://x/api/entities/records', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          entityId: 'user:qa_entity',
          recordId: 'not-a-uuid',
          values: { title: 'Test' },
        }),
      })
      await POST(req)
      expect(mockDataEngine.createCustomEntityRecord).toHaveBeenCalledWith(
        expect.objectContaining({ recordId: undefined }),
      )
    })
  })

  describe('PUT /api/entities/records', () => {
    it('updates an existing record by UUID', async () => {
      mockCustomFieldDefsLookup(['title'])
      const recordId = '123e4567-e89b-12d3-a456-426614174000'
      const req = new Request('http://x/api/entities/records', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          entityId: 'user:qa_entity',
          recordId,
          values: { title: 'Updated Title' },
        }),
      })
      const res = await PUT(req)
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.ok).toBe(true)
      expect(json.item).toMatchObject({ entityId: 'user:qa_entity', recordId })
      expect(mockDataEngine.updateCustomEntityRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          entityId: 'user:qa_entity',
          recordId,
          values: { title: 'Updated Title' },
        }),
      )
    })

    it('falls back to create when recordId is sentinel value', async () => {
      mockCustomFieldDefsLookup(['title'])
      const req = new Request('http://x/api/entities/records', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          entityId: 'user:qa_entity',
          recordId: 'create',
          values: { title: 'New via PUT' },
        }),
      })
      const res = await PUT(req)
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.item.recordId).toBe('rec-001')
      expect(mockDataEngine.createCustomEntityRecord).toHaveBeenCalled()
      expect(mockDataEngine.updateCustomEntityRecord).not.toHaveBeenCalled()
    })

    it('rejects missing entityId and recordId with 400', async () => {
      const req = new Request('http://x/api/entities/records', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ values: { title: 'oops' } }),
      })
      const res = await PUT(req)
      expect(res.status).toBe(400)
    })
  })

  describe('DELETE /api/entities/records', () => {
    it('soft-deletes a record via query params', async () => {
      const req = new Request(
        'http://x/api/entities/records?entityId=user:qa_entity&recordId=123e4567-e89b-12d3-a456-426614174000',
        { method: 'DELETE' },
      )
      const res = await DELETE(req)
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.ok).toBe(true)
      expect(mockDataEngine.deleteCustomEntityRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          entityId: 'user:qa_entity',
          recordId: '123e4567-e89b-12d3-a456-426614174000',
          soft: true,
        }),
      )
    })

    it('soft-deletes a record via JSON body', async () => {
      const req = new Request('http://x/api/entities/records', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          entityId: 'user:qa_entity',
          recordId: '123e4567-e89b-12d3-a456-426614174000',
        }),
      })
      const res = await DELETE(req)
      expect(res.status).toBe(200)
      expect(mockDataEngine.deleteCustomEntityRecord).toHaveBeenCalled()
    })

    it('rejects missing fields with 400', async () => {
      const req = new Request('http://x/api/entities/records', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entityId: 'user:qa_entity' }),
      })
      const res = await DELETE(req)
      expect(res.status).toBe(400)
    })

    it('rejects a stale delete with 409 when the expected version does not match (#3227)', async () => {
      mockRecordUpdatedAt = '2026-05-01T00:00:00.000Z'
      const recordId = '123e4567-e89b-12d3-a456-426614174000'
      const req = new Request(
        `http://x/api/entities/records?entityId=user:qa_entity&recordId=${recordId}`,
        {
          method: 'DELETE',
          headers: { 'x-om-ext-optimistic-lock-expected-updated-at': '2026-04-01T00:00:00.000Z' },
        },
      )
      const res = await DELETE(req)
      expect(res.status).toBe(409)
      const json = await res.json()
      expect(json.code).toBe('optimistic_lock_conflict')
      expect(json.currentUpdatedAt).toBe('2026-05-01T00:00:00.000Z')
      expect(mockDataEngine.deleteCustomEntityRecord).not.toHaveBeenCalled()
    })

    it('allows the delete when the expected version matches the current version (#3227)', async () => {
      mockRecordUpdatedAt = '2026-05-01T00:00:00.000Z'
      const recordId = '123e4567-e89b-12d3-a456-426614174000'
      const req = new Request(
        `http://x/api/entities/records?entityId=user:qa_entity&recordId=${recordId}`,
        {
          method: 'DELETE',
          headers: { 'x-om-ext-optimistic-lock-expected-updated-at': '2026-05-01T00:00:00.000Z' },
        },
      )
      const res = await DELETE(req)
      expect(res.status).toBe(200)
      expect(mockDataEngine.deleteCustomEntityRecord).toHaveBeenCalledWith(
        expect.objectContaining({ recordId, soft: true }),
      )
    })

    it('deletes without a conflict when the client sends no expected version (#3227)', async () => {
      mockRecordUpdatedAt = '2026-05-01T00:00:00.000Z'
      const recordId = '123e4567-e89b-12d3-a456-426614174000'
      const req = new Request(
        `http://x/api/entities/records?entityId=user:qa_entity&recordId=${recordId}`,
        { method: 'DELETE' },
      )
      const res = await DELETE(req)
      expect(res.status).toBe(200)
      expect(mockDataEngine.deleteCustomEntityRecord).toHaveBeenCalled()
    })
  })

  // Per-entity ACL enforcement for a custom entity flagged access_restricted.
  // classifyRecordsEntity resolves the flag from the CustomEntity row; the four
  // verbs must all deny a coarse-only holder and allow a per-entity holder (#3857).
  describe('restricted custom entity records require the per-entity feature', () => {
    const RESTRICTED_ENTITY = 'hr:salaries'
    const RECORD_ID = '123e4567-e89b-12d3-a456-426614174000'

    beforeEach(() => {
      // classifyRecordsEntity → CustomEntity lookup returns a restricted row.
      mockEm.findOne.mockResolvedValue({ accessRestricted: true })
    })

    afterEach(() => {
      // Restore the shared defaults so other blocks keep the superadmin path.
      mockEm.findOne.mockResolvedValue(null)
      mockRbac.loadAcl.mockResolvedValue({ isSuperAdmin: true, features: [], organizations: null })
    })

    function grant(features: string[]) {
      mockRbac.loadAcl.mockResolvedValue({ isSuperAdmin: false, features, organizations: null })
    }

    it('GET denies a coarse-only viewer with 403', async () => {
      grant(['entities.records.view'])
      const req = new Request(`http://x/api/entities/records?entityId=${RESTRICTED_ENTITY}`, { method: 'GET' })
      const res = await GET(req)
      expect(res.status).toBe(403)
    })

    it('POST denies a coarse-only manager with 403 and does not write', async () => {
      grant(['entities.records.manage'])
      const req = new Request('http://x/api/entities/records', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entityId: RESTRICTED_ENTITY, values: { amount: 1000 } }),
      })
      const res = await POST(req)
      expect(res.status).toBe(403)
      expect(mockDataEngine.createCustomEntityRecord).not.toHaveBeenCalled()
    })

    it('POST allows a holder of the per-entity manage feature', async () => {
      grant(['entities.records.manage', 'entities.records.hr:salaries.manage'])
      mockCustomFieldDefsLookup(['amount'])
      const req = new Request('http://x/api/entities/records', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entityId: RESTRICTED_ENTITY, values: { amount: 1000 } }),
      })
      const res = await POST(req)
      expect(res.status).toBe(200)
      expect(mockDataEngine.createCustomEntityRecord).toHaveBeenCalledWith(
        expect.objectContaining({ entityId: RESTRICTED_ENTITY }),
      )
    })

    it('PUT denies a coarse-only manager with 403', async () => {
      grant(['entities.records.manage'])
      const req = new Request('http://x/api/entities/records', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entityId: RESTRICTED_ENTITY, recordId: RECORD_ID, values: { amount: 5 } }),
      })
      const res = await PUT(req)
      expect(res.status).toBe(403)
      expect(mockDataEngine.updateCustomEntityRecord).not.toHaveBeenCalled()
    })

    it('DELETE denies a coarse-only manager with 403', async () => {
      grant(['entities.records.manage'])
      const req = new Request(
        `http://x/api/entities/records?entityId=${RESTRICTED_ENTITY}&recordId=${RECORD_ID}`,
        { method: 'DELETE' },
      )
      const res = await DELETE(req)
      expect(res.status).toBe(403)
      expect(mockDataEngine.deleteCustomEntityRecord).not.toHaveBeenCalled()
    })

    it('DELETE allows a holder of the per-entity manage feature', async () => {
      grant(['entities.records.manage', 'entities.records.hr:salaries.manage'])
      const req = new Request(
        `http://x/api/entities/records?entityId=${RESTRICTED_ENTITY}&recordId=${RECORD_ID}`,
        { method: 'DELETE' },
      )
      const res = await DELETE(req)
      expect(res.status).toBe(200)
      expect(mockDataEngine.deleteCustomEntityRecord).toHaveBeenCalledWith(
        expect.objectContaining({ entityId: RESTRICTED_ENTITY, recordId: RECORD_ID, soft: true }),
      )
    })

    it('GET allows a superadmin regardless of the restriction', async () => {
      mockRbac.loadAcl.mockResolvedValue({ isSuperAdmin: true, features: [], organizations: null })
      const req = new Request(`http://x/api/entities/records?entityId=${RESTRICTED_ENTITY}`, { method: 'GET' })
      const res = await GET(req)
      expect(res.status).toBe(200)
    })

    it('resolves the restricted flag from a TENANT-SCOPED lookup (not a bare entityId match)', async () => {
      // Regression guard for the cross-tenant entityId-collision bypass: the
      // CustomEntity lookup that decides `access_restricted` must be scoped to the
      // caller's tenant, never `{ entityId }` alone.
      grant(['entities.records.view'])
      const req = new Request(`http://x/api/entities/records?entityId=${RESTRICTED_ENTITY}`, { method: 'GET' })
      await GET(req)
      const customEntityLookups = mockEm.findOne.mock.calls.filter(
        ([, where]) => where && typeof where === 'object' && (where as any).entityId === RESTRICTED_ENTITY,
      )
      expect(customEntityLookups.length).toBeGreaterThan(0)
      // Every restriction-deciding lookup carries a tenant scope.
      expect(customEntityLookups[0][1]).toEqual(expect.objectContaining({ tenantId: 't1' }))
    })
  })
})
