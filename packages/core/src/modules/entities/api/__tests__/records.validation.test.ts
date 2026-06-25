/** @jest-environment node */
import { POST, PUT } from '@open-mercato/core/modules/entities/api/records'
import { CustomEntity, CustomFieldDef } from '../../data/entities'

const mockEm = {
  find: jest.fn(async () => [] as Array<Record<string, unknown>>),
  findOne: jest.fn(async () => null),
}

const mockDataEngine = {
  createCustomEntityRecord: jest.fn(async () => ({ id: 'rec-1' })),
  updateCustomEntityRecord: jest.fn(async () => undefined),
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
      return mockDataEngine
    },
  }),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: () => ({ orgId: 'org', tenantId: 't1', roles: ['admin'] }) }))

describe('Records API validation (custom fields)', () => {
  beforeEach(() => { jest.clearAllMocks() })

  it('POST rejects invalid custom fields with 400 and fields map', async () => {
    // Emulate definition with required + integer
    mockEm.find.mockImplementation(async (entityClass: unknown) => {
      if (entityClass === CustomFieldDef) {
        return [
          { key: 'priority', kind: 'integer', configJson: { validation: [ { rule: 'required', message: 'priority required' }, { rule: 'integer', message: 'priority int' } ] }, organizationId: 'org', tenantId: 't1' },
        ]
      }
      if (entityClass === CustomEntity) return []
      return []
    })
    const req = new Request('http://x/api/entities/records', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entityId: 'example:todo', values: { cf_priority: '' } }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json?.error).toBe('Validation failed')
    expect(json?.fields?.cf_priority).toBe('priority required')
  })

  it('PUT accepts valid input', async () => {
    mockEm.find.mockImplementation(async (entityClass: unknown) => {
      if (entityClass === CustomFieldDef) {
        return [
          { key: 'priority', kind: 'integer', configJson: { validation: [ { rule: 'integer', message: 'priority int' } ] }, organizationId: null, tenantId: null },
        ]
      }
      if (entityClass === CustomEntity) return []
      return []
    })
    const req = new Request('http://x/api/entities/records', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entityId: 'example:todo', recordId: '123e4567-e89b-12d3-a456-426614174000', values: { cf_priority: 3 } }),
    })
    const res = await PUT(req)
    expect(res.status).toBe(200)
    expect(mockDataEngine.updateCustomEntityRecord).toHaveBeenCalled()
  })

  it('PUT strips reserved record columns (id/updated_at/updatedAt) instead of rejecting them as custom fields', async () => {
    // The generic edit form echoes the loaded record's id + updated_at/updatedAt (the latter
    // for optimistic locking) back inside `values`. They are system columns, not custom fields,
    // so the API must ignore them — otherwise they validate as cf_id/cf_updated_at/... and the
    // whole save 400s (every custom-entity edit-form save).
    mockEm.find.mockImplementation(async (entityClass: unknown) => {
      if (entityClass === CustomFieldDef) {
        return [
          { key: 'name', kind: 'text', configJson: {}, organizationId: null, tenantId: null },
        ]
      }
      if (entityClass === CustomEntity) return []
      return []
    })
    const req = new Request('http://x/api/entities/records', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        entityId: 'example:todo',
        recordId: '123e4567-e89b-12d3-a456-426614174000',
        values: {
          id: '123e4567-e89b-12d3-a456-426614174000',
          name: 'Edited',
          updated_at: '2026-06-14 23:07:31.007459+00',
          updatedAt: '2026-06-14 23:07:31.007459+00',
        },
      }),
    })
    const res = await PUT(req)
    expect(res.status).toBe(200)
    expect(mockDataEngine.updateCustomEntityRecord).toHaveBeenCalled()
    const writtenValues = (mockDataEngine.updateCustomEntityRecord.mock.calls[0]?.[0] as any)?.values ?? {}
    expect(writtenValues).not.toHaveProperty('id')
    expect(writtenValues).not.toHaveProperty('updated_at')
    expect(writtenValues).not.toHaveProperty('updatedAt')
  })

  it('PUT still rejects genuinely undeclared custom fields (reserved-key strip is targeted)', async () => {
    mockEm.find.mockImplementation(async (entityClass: unknown) => {
      if (entityClass === CustomFieldDef) {
        return [
          { key: 'name', kind: 'text', configJson: {}, organizationId: null, tenantId: null },
        ]
      }
      if (entityClass === CustomEntity) return []
      return []
    })
    const req = new Request('http://x/api/entities/records', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        entityId: 'example:todo',
        recordId: '123e4567-e89b-12d3-a456-426614174000',
        values: { name: 'ok', totally_unknown_field: 'x' },
      }),
    })
    const res = await PUT(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json?.error).toBe('Validation failed')
  })
})
