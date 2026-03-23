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
import { deleteCatalogProductsWithProgress } from '../bulkDelete'

describe('deleteCatalogProductsWithProgress', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('invalidates the products collection cache before completing the bulk delete job', async () => {
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
    expect(mockInvalidateCrudCache).toHaveBeenCalledWith(
      container,
      'catalog.product',
      {
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
})
