/** @jest-environment node */

const mockFindOneWithDecryption = jest.fn()
const mockExecuteAction = jest.fn()
const mockResolveOptionalEventBus = jest.fn()
const mockRunWithCacheTenant = jest.fn(async (_tenantId: string, fn: () => Promise<unknown>) => fn())
const mockResolveCache = jest.fn()
const mockInvalidateCountsCache = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
  findWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/inbox_ops/lib/executionEngine', () => ({
  executeAction: (...args: unknown[]) => mockExecuteAction(...args),
}))

jest.mock('@open-mercato/core/modules/inbox_ops/lib/eventBus', () => ({
  resolveOptionalEventBus: (...args: unknown[]) => mockResolveOptionalEventBus(...args),
}))

jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: (...args: unknown[]) => mockRunWithCacheTenant(...args),
}))

jest.mock('@open-mercato/core/modules/inbox_ops/lib/cache', () => ({
  resolveCache: (...args: unknown[]) => mockResolveCache(...args),
  invalidateCountsCache: (...args: unknown[]) => mockInvalidateCountsCache(...args),
}))

import aiTools from '../ai-tools'

describe('inbox_ops aiTools', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockExecuteAction.mockResolvedValue({
      success: true,
      createdEntityId: 'entity-1',
      createdEntityType: 'catalog_product',
    })
    mockResolveOptionalEventBus.mockReturnValue(null)
    mockInvalidateCountsCache.mockResolvedValue(undefined)
  })

  it('invalidates counts cache inside tenant cache context after accepting an action', async () => {
    const em = {
      fork: jest.fn(),
    }
    em.fork.mockReturnValue(em)

    const cache = {
      deleteByTags: jest.fn(),
    }

    const container = {
      resolve: jest.fn((token: string) => {
        if (token === 'em') return em
        throw new Error(`Unknown token: ${token}`)
      }),
    }

    mockFindOneWithDecryption.mockResolvedValueOnce({
      id: 'action-1',
      proposalId: 'proposal-1',
      status: 'pending',
      requiredFeature: null,
      payload: {},
    })
    mockResolveCache.mockReturnValue(cache)

    const tool = aiTools.find((candidate) => candidate.name === 'inbox_ops_accept_action')
    if (!tool) {
      throw new Error('Accept action tool not found')
    }

    const result = await tool.handler(
      { proposalId: 'proposal-1', actionId: 'action-1' } as never,
      {
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        userId: 'user-1',
        container: container as never,
        userFeatures: ['inbox_ops.proposals.manage'],
        isSuperAdmin: false,
      },
    )

    expect(result).toEqual({
      ok: true,
      createdEntityId: 'entity-1',
      createdEntityType: 'catalog_product',
    })
    expect(mockRunWithCacheTenant).toHaveBeenCalledWith('tenant-1', expect.any(Function))
    expect(mockInvalidateCountsCache).toHaveBeenCalledWith(cache, 'tenant-1')
  })
})
