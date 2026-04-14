/** @jest-environment node */
import { POST, PUT, DELETE } from '@open-mercato/core/modules/entities/api/records'

const mockEm = {
  find: jest.fn(async () => [] as Array<Record<string, unknown>>),
  findOne: jest.fn(async () => null),
}

const mockDataEngine = {
  createCustomEntityRecord: jest.fn(async () => ({ id: 'rec-001' })),
  updateCustomEntityRecord: jest.fn(async () => undefined),
  deleteCustomEntityRecord: jest.fn(async () => undefined),
}

const mockRbac = {
  resolveVisibleOrganizations: jest.fn(async () => ['org']),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (k: string) => {
      if (k === 'em') return mockEm
      if (k === 'rbacService') return mockRbac
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
  beforeEach(() => { jest.clearAllMocks() })

  describe('POST /api/entities/records', () => {
    it('creates a record and returns entityId + recordId', async () => {
      mockEm.find.mockResolvedValueOnce([])
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
      mockEm.find.mockResolvedValueOnce([])
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
      mockEm.find.mockResolvedValueOnce([])
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
      mockEm.find.mockResolvedValueOnce([])
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
      mockEm.find.mockResolvedValueOnce([])
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
  })
})
