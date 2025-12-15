/** @jest-environment node */
import { GET, POST } from '@open-mercato/core/modules/entities/api/encryption'

const mockMapRepo = {
  findOne: jest.fn(),
  create: jest.fn((data) => data),
}
const mockEm = {
  getRepository: () => mockMapRepo,
  persistAndFlush: jest.fn(),
}

const mockEncSvc = {
  invalidateMap: jest.fn(async () => {}),
}

jest.mock('@/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (k: string) => {
      if (k === 'em') return mockEm
      if (k === 'tenantEncryptionService') return mockEncSvc
      return null
    },
  }),
}))

jest.mock('@/lib/auth/server', () => ({
  getAuthFromRequest: () => ({ tenantId: 't-1', orgId: 'o-1', roles: ['admin'] }),
}))

describe('entities/encryption API', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns empty map when none exists', async () => {
    mockMapRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    const res = await GET(new Request('http://x/api/entities/encryption?entityId=auth:user'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toMatchObject({ entityId: 'auth:user', fields: [] })
  })

  it('creates map on POST and invalidates cache', async () => {
    mockMapRepo.findOne.mockResolvedValue(null)
    const payload = { entityId: 'auth:user', fields: [{ field: 'email', hashField: 'email_hash' }] }
    const res = await POST(new Request('http://x/api/entities/encryption', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
    }))
    expect(res.status).toBe(200)
    expect(mockMapRepo.create).toHaveBeenCalled()
    expect(mockEm.persistAndFlush).toHaveBeenCalled()
    expect(mockEncSvc.invalidateMap).toHaveBeenCalledWith('auth:user', 't-1', 'o-1')
  })
})
