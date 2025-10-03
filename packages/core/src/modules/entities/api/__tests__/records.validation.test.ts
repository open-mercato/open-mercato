/** @jest-environment node */
import { POST, PUT } from '@open-mercato/core/modules/entities/api/records'

const mockEm = {
  find: jest.fn(async () => []),
  findOne: jest.fn(async () => null),
}

const mockDataEngine = {
  createCustomEntityRecord: jest.fn(async () => ({ id: 'rec-1' })),
  updateCustomEntityRecord: jest.fn(async () => undefined),
}

jest.mock('@/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: (k: string) => (k === 'em' ? mockEm : mockDataEngine) }),
}))

jest.mock('@/lib/auth/server', () => ({ getAuthFromRequest: () => ({ orgId: 'org', tenantId: 't1', roles: ['admin'] }) }))

describe('Records API validation (custom fields)', () => {
  beforeEach(() => { jest.clearAllMocks() })

  it('POST rejects invalid custom fields with 400 and fields map', async () => {
    // Emulate definition with required + integer
    mockEm.find.mockResolvedValueOnce([
      { key: 'priority', kind: 'integer', configJson: { validation: [ { rule: 'required', message: 'priority required' }, { rule: 'integer', message: 'priority int' } ] }, organizationId: 'org', tenantId: 't1' }
    ])
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
    mockEm.find.mockResolvedValueOnce([
      { key: 'priority', kind: 'integer', configJson: { validation: [ { rule: 'integer', message: 'priority int' } ] }, organizationId: null, tenantId: null }
    ])
    const req = new Request('http://x/api/entities/records', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entityId: 'example:todo', recordId: '123e4567-e89b-12d3-a456-426614174000', values: { cf_priority: 3 } }),
    })
    const res = await PUT(req)
    expect(res.status).toBe(200)
    expect(mockDataEngine.updateCustomEntityRecord).toHaveBeenCalled()
  })
})
