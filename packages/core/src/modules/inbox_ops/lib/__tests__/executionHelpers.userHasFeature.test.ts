/** @jest-environment node */

import { userHasFeature } from '../executionHelpers'
import type { ExecutionHelperContext } from '../executionHelpers'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

const mockRbacService = {
  userHasAllFeatures: jest.fn(),
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'rbacService') return mockRbacService
    return null
  }),
}

function makeCtx(overrides?: Partial<ExecutionHelperContext>): ExecutionHelperContext {
  return {
    em: {} as ExecutionHelperContext['em'],
    userId: 'user-1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    container: mockContainer as unknown as ExecutionHelperContext['container'],
    ...overrides,
  } as ExecutionHelperContext
}

describe('userHasFeature (#2700 fail-closed)', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    mockRbacService.userHasAllFeatures.mockResolvedValue(true)
    mockContainer.resolve.mockImplementation((token: string) => {
      if (token === 'rbacService') return mockRbacService
      return null
    })
  })

  it.each([
    ['empty string', ''],
    ['whitespace-only string', '   '],
    ['undefined', undefined as unknown as string],
    ['null', null as unknown as string],
  ])('fails closed when feature is %s', async (_label, feature) => {
    const result = await userHasFeature(makeCtx(), feature)

    expect(result).toBe(false)
    expect(mockRbacService.userHasAllFeatures).not.toHaveBeenCalled()
  })

  it('does not grant access to a non-superadmin when feature is missing', async () => {
    const result = await userHasFeature(
      makeCtx({ auth: { isSuperAdmin: false } as ExecutionHelperContext['auth'] }),
      '',
    )
    expect(result).toBe(false)
  })

  it('does not grant access to a superadmin when feature is missing (fail closed first)', async () => {
    const result = await userHasFeature(
      makeCtx({ auth: { isSuperAdmin: true } as ExecutionHelperContext['auth'] }),
      '',
    )
    expect(result).toBe(false)
  })

  it('delegates to rbacService when a concrete feature is supplied', async () => {
    mockRbacService.userHasAllFeatures.mockResolvedValue(true)
    const result = await userHasFeature(makeCtx(), 'sales.orders.manage')

    expect(result).toBe(true)
    expect(mockRbacService.userHasAllFeatures).toHaveBeenCalledWith(
      'user-1',
      ['sales.orders.manage'],
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
  })

  it('denies when rbacService reports the user lacks the feature', async () => {
    mockRbacService.userHasAllFeatures.mockResolvedValue(false)
    const result = await userHasFeature(makeCtx(), 'sales.orders.manage')
    expect(result).toBe(false)
  })

  it('grants a superadmin a concrete feature without calling rbacService', async () => {
    const result = await userHasFeature(
      makeCtx({ auth: { isSuperAdmin: true } as ExecutionHelperContext['auth'] }),
      'sales.orders.manage',
    )
    expect(result).toBe(true)
    expect(mockRbacService.userHasAllFeatures).not.toHaveBeenCalled()
  })
})
