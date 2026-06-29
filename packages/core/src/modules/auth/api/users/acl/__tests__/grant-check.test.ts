/** @jest-environment node */

import { UserAcl } from '@open-mercato/core/modules/auth/data/entities'
import { PUT } from '../route'

const ACTOR_TENANT_ID = '123e4567-e89b-12d3-a456-426614174001'
const ACTOR_USER_ID = '123e4567-e89b-12d3-a456-426614174002'
const TARGET_USER_ID = '123e4567-e89b-12d3-a456-426614174003'

const mockGetAuthFromRequest = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockDeleteByTags = jest.fn()

const mockEm = {
  findOne: jest.fn(),
  create: jest.fn(),
  persist: jest.fn(),
  remove: jest.fn(),
}

const mockRbacService = {
  loadAcl: jest.fn(),
  invalidateUserCache: jest.fn(),
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'rbacService') return mockRbacService
    if (token === 'cache') return { deleteByTags: mockDeleteByTags }
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((req: Request) => mockGetAuthFromRequest(req)),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn((...args: unknown[]) => mockFindWithDecryption(...args)),
}))

jest.mock('@open-mercato/shared/lib/commands/flush', () => ({
  withAtomicFlush: jest.fn(async (_em: unknown, phases: Array<() => unknown>) => {
    for (const phase of phases) await phase()
  }),
}))

describe('user ACL grant-boundary enforcement', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({
      sub: ACTOR_USER_ID,
      tenantId: ACTOR_TENANT_ID,
      orgId: 'org-1',
    })
    mockFindWithDecryption.mockResolvedValue([])
    mockRbacService.loadAcl.mockResolvedValue({
      isSuperAdmin: false,
      features: ['auth.acl.manage'],
      organizations: null,
    })
    mockEm.findOne.mockResolvedValue(null)
    mockEm.create.mockImplementation((_entity: unknown, values: Record<string, unknown>) => ({ ...values }))
  })

  it('PUT rejects feature grants outside the actor effective ACL', async () => {
    const res = await PUT(
      new Request('http://localhost/api/auth/users/acl', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId: TARGET_USER_ID,
          features: ['auth.acl.manage', 'sales.*'],
        }),
      }),
    )
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toContain('Cannot grant feature wildcard sales.*')
    expect(mockEm.create).not.toHaveBeenCalledWith(UserAcl, expect.anything())
    expect(mockEm.persist).not.toHaveBeenCalled()
    expect(mockRbacService.invalidateUserCache).not.toHaveBeenCalled()
    expect(mockDeleteByTags).not.toHaveBeenCalled()
  })
})
