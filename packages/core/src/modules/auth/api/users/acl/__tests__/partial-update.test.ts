/** @jest-environment node */

import { PUT } from '../route'

const ACTOR_TENANT_ID = '123e4567-e89b-12d3-a456-426614174001'
const ACTOR_USER_ID = '123e4567-e89b-12d3-a456-426614174002'
const TARGET_USER_ID = '123e4567-e89b-12d3-a456-426614174003'
const ACME_ORGANIZATION_ID = '123e4567-e89b-12d3-a456-426614174010'

const mockGetAuthFromRequest = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockDeleteByTags = jest.fn()

type StoredAcl = {
  id: string
  isSuperAdmin: boolean
  featuresJson: string[]
  organizationsJson: string[] | null
  updatedAt: Date | null
}

let storedAcl: StoredAcl | null = null

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

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({
    selectedId: 'org-1',
    filterIds: ['org-1'],
    allowedIds: null,
    tenantId: '123e4567-e89b-12d3-a456-426614174001',
  })),
}))

jest.mock('@open-mercato/shared/lib/commands/flush', () => ({
  withAtomicFlush: jest.fn(async (_em: unknown, phases: Array<() => unknown>) => {
    for (const phase of phases) await phase()
  }),
}))

jest.mock('@open-mercato/shared/lib/crud/optimistic-lock-command', () => ({
  enforceCommandOptimisticLockWithGuards: jest.fn(async () => {}),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback: string) => fallback,
  })),
}))

function putRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/auth/users/acl', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('user ACL partial updates', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    storedAcl = null
    mockGetAuthFromRequest.mockResolvedValue({
      sub: ACTOR_USER_ID,
      tenantId: ACTOR_TENANT_ID,
      orgId: 'org-1',
    })
    mockFindWithDecryption.mockResolvedValue([])
    mockRbacService.loadAcl.mockResolvedValue({
      isSuperAdmin: false,
      features: ['auth.acl.manage', 'dashboards.view'],
      organizations: null,
    })
    // `isUserEffectivelySuperAdmin` probes with `isSuperAdmin: true`; every other
    // lookup is the route loading the target user's stored ACL row.
    mockEm.findOne.mockImplementation((_entity: unknown, filter: Record<string, unknown>) => (
      filter?.isSuperAdmin === true ? null : storedAcl
    ))
    mockEm.create.mockImplementation((_entity: unknown, values: Record<string, unknown>) => ({ ...values }))
  })

  it('preserves the stored feature grant when only organizations are submitted', async () => {
    storedAcl = {
      id: 'acl-1',
      isSuperAdmin: false,
      featuresJson: ['dashboards.view'],
      organizationsJson: null,
      updatedAt: null,
    }

    const res = await PUT(putRequest({
      userId: TARGET_USER_ID,
      organizations: [ACME_ORGANIZATION_ID],
    }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, sanitized: false })
    expect(mockEm.remove).not.toHaveBeenCalled()
    expect(mockEm.persist).toHaveBeenCalledTimes(1)
    expect(storedAcl).toMatchObject({
      isSuperAdmin: false,
      featuresJson: ['dashboards.view'],
      organizationsJson: [ACME_ORGANIZATION_ID],
    })
  })

  it('preserves the stored organization scope when only features are submitted', async () => {
    storedAcl = {
      id: 'acl-1',
      isSuperAdmin: false,
      featuresJson: ['dashboards.view'],
      organizationsJson: [ACME_ORGANIZATION_ID],
      updatedAt: null,
    }

    const res = await PUT(putRequest({
      userId: TARGET_USER_ID,
      features: ['auth.acl.manage'],
    }))

    expect(res.status).toBe(200)
    expect(mockEm.remove).not.toHaveBeenCalled()
    expect(storedAcl).toMatchObject({
      featuresJson: ['auth.acl.manage'],
      organizationsJson: [ACME_ORGANIZATION_ID],
    })
  })

  it('rejects an organization scope that would leave the user without any feature grant', async () => {
    const res = await PUT(putRequest({
      userId: TARGET_USER_ID,
      organizations: [ACME_ORGANIZATION_ID],
    }))

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      error: expect.stringContaining('at least one feature override'),
    })
    expect(mockEm.persist).not.toHaveBeenCalled()
    expect(mockEm.remove).not.toHaveBeenCalled()
    expect(mockRbacService.invalidateUserCache).not.toHaveBeenCalled()
  })

  it('still clears the override when every dimension is explicitly emptied', async () => {
    const existing = {
      id: 'acl-1',
      isSuperAdmin: false,
      featuresJson: ['dashboards.view'],
      organizationsJson: [ACME_ORGANIZATION_ID],
      updatedAt: null,
    }
    storedAcl = existing

    const res = await PUT(putRequest({
      userId: TARGET_USER_ID,
      features: [],
      organizations: null,
    }))

    expect(res.status).toBe(200)
    expect(mockEm.remove).toHaveBeenCalledWith(existing)
    expect(mockEm.persist).not.toHaveBeenCalled()
  })

  it('keeps an omitted super admin flag intact', async () => {
    mockRbacService.loadAcl.mockResolvedValue({
      isSuperAdmin: true,
      features: ['*'],
      organizations: null,
    })
    storedAcl = {
      id: 'acl-1',
      isSuperAdmin: true,
      featuresJson: [],
      organizationsJson: null,
      updatedAt: null,
    }

    const res = await PUT(putRequest({
      userId: TARGET_USER_ID,
      organizations: [ACME_ORGANIZATION_ID],
    }))

    expect(res.status).toBe(200)
    expect(mockEm.remove).not.toHaveBeenCalled()
    expect(storedAcl).toMatchObject({
      isSuperAdmin: true,
      organizationsJson: [ACME_ORGANIZATION_ID],
    })
  })
})
