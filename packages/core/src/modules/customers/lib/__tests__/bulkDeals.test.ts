const mockInvalidateCrudCache = jest.fn().mockResolvedValue(undefined)

jest.mock('@open-mercato/shared/lib/crud/cache', () => ({
  invalidateCrudCache: mockInvalidateCrudCache,
}))

jest.mock('@open-mercato/queue', () => ({
  createModuleQueue: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/redis/connection', () => ({
  getRedisUrl: jest.fn(),
}))

import type { AwilixContainer } from 'awilix'
import { getCurrentCacheTenant } from '@open-mercato/cache'
import {
  bulkUpdateDealOwnerWithProgress,
  bulkUpdateDealStageWithProgress,
} from '../bulkDeals'

describe('customers deal bulk update helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('updates stages through the command bus and invalidates updated deal caches in tenant scope', async () => {
    const execute = jest.fn().mockResolvedValue({ result: { dealId: 'deal-1' } })
    const startJob = jest.fn().mockResolvedValue(undefined)
    const updateProgress = jest.fn().mockResolvedValue(undefined)
    const completeJob = jest.fn().mockResolvedValue(undefined)

    const container = {
      resolve: jest.fn((name: string) => {
        if (name === 'commandBus') return { execute }
        if (name === 'progressService') return { startJob, updateProgress, completeJob }
        return undefined
      }),
    } as unknown as AwilixContainer

    const observedTenants: Array<string | null> = []
    mockInvalidateCrudCache.mockImplementation(async () => {
      observedTenants.push(getCurrentCacheTenant())
    })

    const summary = await bulkUpdateDealStageWithProgress({
      container,
      progressJobId: 'job-1',
      ids: ['deal-1', 'deal-2'],
      pipelineStageId: 'stage-1',
      scope: {
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
      },
    })

    expect(summary).toEqual({ affectedCount: 2, failedCount: 0 })
    expect(execute).toHaveBeenNthCalledWith(1, 'customers.deals.update', {
      input: { body: { id: 'deal-1', pipelineStageId: 'stage-1' } },
      ctx: expect.objectContaining({
        selectedOrganizationId: 'org-1',
        organizationIds: ['org-1'],
      }),
      skipCacheInvalidation: true,
    })
    expect(execute).toHaveBeenNthCalledWith(2, 'customers.deals.update', {
      input: { body: { id: 'deal-2', pipelineStageId: 'stage-1' } },
      ctx: expect.objectContaining({
        selectedOrganizationId: 'org-1',
        organizationIds: ['org-1'],
      }),
      skipCacheInvalidation: true,
    })
    expect(mockInvalidateCrudCache).toHaveBeenCalledTimes(2)
    expect(observedTenants).toEqual(['tenant-1', 'tenant-1'])
    expect(completeJob).toHaveBeenCalledWith(
      'job-1',
      { resultSummary: { affectedCount: 2, failedCount: 0 } },
      { tenantId: 'tenant-1', organizationId: 'org-1', userId: 'user-1' },
    )
  })

  it('records per-row failures and only invalidates successfully updated owner changes', async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce({ result: { dealId: 'deal-1' } })
      .mockRejectedValueOnce(new Error('locked'))
    const startJob = jest.fn().mockResolvedValue(undefined)
    const updateProgress = jest.fn().mockResolvedValue(undefined)
    const completeJob = jest.fn().mockResolvedValue(undefined)
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)

    const container = {
      resolve: jest.fn((name: string) => {
        if (name === 'commandBus') return { execute }
        if (name === 'progressService') return { startJob, updateProgress, completeJob }
        return undefined
      }),
    } as unknown as AwilixContainer

    try {
      const summary = await bulkUpdateDealOwnerWithProgress({
        container,
        progressJobId: 'job-2',
        ids: ['deal-1', 'deal-2'],
        ownerUserId: null,
        scope: {
          organizationId: 'org-1',
          tenantId: 'tenant-1',
          userId: 'user-1',
        },
      })

      expect(summary).toEqual({ affectedCount: 1, failedCount: 1 })
      expect(mockInvalidateCrudCache).toHaveBeenCalledTimes(1)
      expect(mockInvalidateCrudCache).toHaveBeenCalledWith(
        container,
        'customers.deal',
        { id: 'deal-1', organizationId: 'org-1', tenantId: 'tenant-1' },
        'tenant-1',
        'bulk-update-owner:customers.deals',
        ['customers.deals'],
      )
      expect(completeJob).toHaveBeenCalledWith(
        'job-2',
        { resultSummary: { affectedCount: 1, failedCount: 1 } },
        { tenantId: 'tenant-1', organizationId: 'org-1', userId: 'user-1' },
      )
    } finally {
      warn.mockRestore()
    }
  })
})
