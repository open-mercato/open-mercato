/** @jest-environment node */

import { userHasFeature, type ExecutionHelperContext } from '../executionHelpers'

const mockRbacService = {
  userHasAllFeatures: jest.fn(),
}

function makeCtx(overrides?: Partial<ExecutionHelperContext>): ExecutionHelperContext {
  return {
    em: {} as ExecutionHelperContext['em'],
    userId: 'user-1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    container: {
      resolve: jest.fn((token: string) => (token === 'rbacService' ? mockRbacService : null)),
    } as unknown as ExecutionHelperContext['container'],
    ...overrides,
  }
}

describe('userHasFeature', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    mockRbacService.userHasAllFeatures.mockResolvedValue(true)
  })

  it('fails closed (returns false) when the feature is an empty string', async () => {
    const result = await userHasFeature(makeCtx(), '')
    expect(result).toBe(false)
    expect(mockRbacService.userHasAllFeatures).not.toHaveBeenCalled()
  })

  it('fails closed (returns false) when the feature is undefined', async () => {
    const result = await userHasFeature(makeCtx(), undefined as unknown as string)
    expect(result).toBe(false)
    expect(mockRbacService.userHasAllFeatures).not.toHaveBeenCalled()
  })

  it('fails closed (returns false) when the feature is null', async () => {
    const result = await userHasFeature(makeCtx(), null as unknown as string)
    expect(result).toBe(false)
    expect(mockRbacService.userHasAllFeatures).not.toHaveBeenCalled()
  })

  it('does not grant access on a missing feature even for super admins', async () => {
    const ctx = makeCtx({ auth: { isSuperAdmin: true } as ExecutionHelperContext['auth'] })
    const result = await userHasFeature(ctx, '')
    expect(result).toBe(false)
  })

  it('grants access to super admins when a concrete feature is supplied', async () => {
    const ctx = makeCtx({ auth: { isSuperAdmin: true } as ExecutionHelperContext['auth'] })
    const result = await userHasFeature(ctx, 'sales.orders.manage')
    expect(result).toBe(true)
    expect(mockRbacService.userHasAllFeatures).not.toHaveBeenCalled()
  })

  it('delegates to the RBAC service for a concrete feature and returns its grant', async () => {
    mockRbacService.userHasAllFeatures.mockResolvedValue(true)
    const result = await userHasFeature(makeCtx(), 'sales.orders.manage')
    expect(result).toBe(true)
    expect(mockRbacService.userHasAllFeatures).toHaveBeenCalledWith(
      'user-1',
      ['sales.orders.manage'],
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
  })

  it('returns false when the RBAC service denies the feature', async () => {
    mockRbacService.userHasAllFeatures.mockResolvedValue(false)
    const result = await userHasFeature(makeCtx(), 'sales.orders.manage')
    expect(result).toBe(false)
  })

  it('fails closed when the RBAC service is unavailable', async () => {
    const ctx = makeCtx({
      container: {
        resolve: jest.fn(() => null),
      } as unknown as ExecutionHelperContext['container'],
    })
    const result = await userHasFeature(ctx, 'sales.orders.manage')
    expect(result).toBe(false)
  })

  it('fails closed when the RBAC service throws', async () => {
    mockRbacService.userHasAllFeatures.mockRejectedValue(new Error('rbac down'))
    const result = await userHasFeature(makeCtx(), 'sales.orders.manage')
    expect(result).toBe(false)
  })
})
