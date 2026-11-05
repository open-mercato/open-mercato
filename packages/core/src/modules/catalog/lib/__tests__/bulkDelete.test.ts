const mockInvalidateCrudCache = jest.fn().mockResolvedValue(undefined)

jest.mock('@open-mercato/shared/lib/crud/cache', () => ({
  invalidateCrudCache: mockInvalidateCrudCache,
}))

jest.mock('@open-mercato/queue', () => ({
  createQueue: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/redis/connection', () => ({
  getRedisUrl: jest.fn(),
}))

import type { AwilixContainer } from 'awilix'
import { getCurrentCacheTenant } from '@open-mercato/cache'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { deleteCatalogProductsWithProgress } from '../bulkDelete'

function buildContainer(execute: jest.Mock) {
  const progressService = {
    startJob: jest.fn().mockResolvedValue(undefined),
    updateProgress: jest.fn().mockResolvedValue(undefined),
    completeJob: jest.fn().mockResolvedValue(undefined),
  }
  const container = {
    resolve: jest.fn((name: string) => {
      if (name === 'commandBus') return { execute }
      if (name === 'progressService') return progressService
      return undefined
    }),
  } as unknown as AwilixContainer
  return { container, progressService }
}

describe('deleteCatalogProductsWithProgress', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('invalidates each deleted product cache after the bulk delete finishes', async () => {
    const execute = jest.fn().mockResolvedValue({ result: { productId: 'prod-1' } })
    const startJob = jest.fn().mockResolvedValue(undefined)
    const updateProgress = jest.fn().mockResolvedValue(undefined)
    const completeJob = jest.fn().mockResolvedValue(undefined)

    const container = {
      resolve: jest.fn((name: string) => {
        if (name === 'commandBus') return { execute }
        if (name === 'progressService') {
          return {
            startJob,
            updateProgress,
            completeJob,
          }
        }
        return undefined
      }),
    } as unknown as AwilixContainer

    await deleteCatalogProductsWithProgress({
      container,
      progressJobId: 'job-1',
      ids: ['prod-1', 'prod-2'],
      scope: {
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
      },
    })

    expect(execute).toHaveBeenCalledTimes(2)
    expect(execute).toHaveBeenNthCalledWith(1, 'catalog.products.delete', {
      input: { body: { id: 'prod-1' } },
      ctx: expect.objectContaining({
        selectedOrganizationId: 'org-1',
        organizationIds: ['org-1'],
      }),
      skipCacheInvalidation: true,
    })
    expect(execute).toHaveBeenNthCalledWith(2, 'catalog.products.delete', {
      input: { body: { id: 'prod-2' } },
      ctx: expect.objectContaining({
        selectedOrganizationId: 'org-1',
        organizationIds: ['org-1'],
      }),
      skipCacheInvalidation: true,
    })
    expect(mockInvalidateCrudCache).toHaveBeenCalledTimes(2)
    expect(mockInvalidateCrudCache).toHaveBeenNthCalledWith(
      1,
      container,
      'catalog.product',
      {
        id: 'prod-1',
        organizationId: 'org-1',
        tenantId: 'tenant-1',
      },
      'tenant-1',
      'bulk-delete:catalog.products',
      ['catalog.products'],
    )
    expect(mockInvalidateCrudCache).toHaveBeenNthCalledWith(
      2,
      container,
      'catalog.product',
      {
        id: 'prod-2',
        organizationId: 'org-1',
        tenantId: 'tenant-1',
      },
      'tenant-1',
      'bulk-delete:catalog.products',
      ['catalog.products'],
    )
    expect(completeJob).toHaveBeenCalledWith(
      'job-1',
      { resultSummary: { affectedCount: 2 } },
      {
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        userId: 'user-1',
      },
    )
  })

  it('invokes cache invalidation inside the correct cache tenant scope so tag deletes match stored entries', async () => {
    const execute = jest.fn().mockResolvedValue({ result: { productId: 'prod-1' } })
    const startJob = jest.fn().mockResolvedValue(undefined)
    const updateProgress = jest.fn().mockResolvedValue(undefined)
    const completeJob = jest.fn().mockResolvedValue(undefined)

    const container = {
      resolve: jest.fn((name: string) => {
        if (name === 'commandBus') return { execute }
        if (name === 'progressService') {
          return { startJob, updateProgress, completeJob }
        }
        return undefined
      }),
    } as unknown as AwilixContainer

    const observedTenants: Array<string | null> = []
    mockInvalidateCrudCache.mockImplementation(async () => {
      observedTenants.push(getCurrentCacheTenant())
    })

    await deleteCatalogProductsWithProgress({
      container,
      progressJobId: 'job-2',
      ids: ['prod-1'],
      scope: {
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
      },
    })

    expect(mockInvalidateCrudCache).toHaveBeenCalledTimes(1)
    expect(observedTenants).toEqual(['tenant-1'])
  })

  it('runs the delete command with an actor bound to the job tenant so tenant scope is enforced', async () => {
    const execute = jest.fn().mockResolvedValue({ result: { productId: 'prod-1' } })
    const { container } = buildContainer(execute)

    await deleteCatalogProductsWithProgress({
      container,
      progressJobId: 'job-3',
      ids: ['prod-1'],
      scope: { organizationId: 'org-1', tenantId: 'tenant-1', userId: 'user-1' },
    })

    const ctx = execute.mock.calls[0][1].ctx as CommandRuntimeContext
    expect(ctx.auth).toEqual(
      expect.objectContaining({
        sub: 'user-1',
        tenantId: 'tenant-1',
        orgId: 'org-1',
        isSuperAdmin: false,
      }),
    )
    expect(ctx.organizationScope).toEqual(
      expect.objectContaining({ allowedIds: ['org-1'], tenantId: 'tenant-1' }),
    )
  })

  it('builds a command context that rejects products from another tenant even when the organization id matches', async () => {
    const execute = jest.fn().mockResolvedValue({ result: { productId: 'prod-1' } })
    const { container } = buildContainer(execute)

    await deleteCatalogProductsWithProgress({
      container,
      progressJobId: 'job-4',
      ids: ['prod-1'],
      scope: { organizationId: 'org-1', tenantId: 'tenant-1', userId: 'user-1' },
    })

    const ctx = execute.mock.calls[0][1].ctx as CommandRuntimeContext
    expect(() => ensureTenantScope(ctx, 'tenant-1')).not.toThrow()
    expect(() => ensureOrganizationScope(ctx, 'org-1')).not.toThrow()
    expect(() => ensureTenantScope(ctx, 'tenant-2')).toThrow(
      expect.objectContaining({ status: 403 }),
    )
  })

  it.each([
    ['tenant', { organizationId: 'org-1', tenantId: '', userId: 'user-1' }],
    ['organization', { organizationId: '', tenantId: 'tenant-1', userId: 'user-1' }],
    ['user', { organizationId: 'org-1', tenantId: 'tenant-1', userId: null }],
  ])('refuses to delete anything when the job payload has no %s scope', async (_label, scope) => {
    const execute = jest.fn().mockResolvedValue({ result: { productId: 'prod-1' } })
    const { container } = buildContainer(execute)

    await expect(
      deleteCatalogProductsWithProgress({
        container,
        progressJobId: 'job-5',
        ids: ['prod-1'],
        scope,
      }),
    ).rejects.toThrow('[internal] Catalog bulk delete requires tenant, organization and user scope')
    expect(execute).not.toHaveBeenCalled()
  })
})
