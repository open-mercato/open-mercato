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
    const stageExecute = jest.fn().mockResolvedValue([{ id: 'stage-1' }])

    const container = {
      resolve: jest.fn((name: string) => {
        if (name === 'commandBus') return { execute }
        if (name === 'progressService') return { startJob, updateProgress, completeJob }
        if (name === 'em') return { getConnection: () => ({ execute: stageExecute }) }
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

    expect(summary).toEqual({ affectedCount: 2, failedCount: 0, failedItems: [] })
    expect(execute).toHaveBeenNthCalledWith(1, 'customers.deals.update', {
      input: { id: 'deal-1', pipelineStageId: 'stage-1' },
      ctx: expect.objectContaining({
        selectedOrganizationId: 'org-1',
        organizationIds: ['org-1'],
      }),
      skipCacheInvalidation: true,
    })
    expect(execute).toHaveBeenNthCalledWith(2, 'customers.deals.update', {
      input: { id: 'deal-2', pipelineStageId: 'stage-1' },
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
      { resultSummary: { affectedCount: 2, failedCount: 0, failedItems: [] } },
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

      expect(summary).toEqual({
        affectedCount: 1,
        failedCount: 1,
        failedItems: [{ id: 'deal-2', message: 'locked' }],
      })
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
        {
          resultSummary: {
            affectedCount: 1,
            failedCount: 1,
            failedItems: [{ id: 'deal-2', message: 'locked' }],
          },
        },
        { tenantId: 'tenant-1', organizationId: 'org-1', userId: 'user-1' },
      )
    } finally {
      warn.mockRestore()
    }
  })

  it('rejects bulk stage update when the target stage is not found in tenant scope', async () => {
    const execute = jest.fn()
    const startJob = jest.fn().mockResolvedValue(undefined)
    const updateProgress = jest.fn().mockResolvedValue(undefined)
    const completeJob = jest.fn().mockResolvedValue(undefined)
    const stageExecute = jest.fn().mockResolvedValue([])

    const container = {
      resolve: jest.fn((name: string) => {
        if (name === 'commandBus') return { execute }
        if (name === 'progressService') return { startJob, updateProgress, completeJob }
        if (name === 'em') return { getConnection: () => ({ execute: stageExecute }) }
        return undefined
      }),
    } as unknown as AwilixContainer

    await expect(
      bulkUpdateDealStageWithProgress({
        container,
        progressJobId: 'job-3',
        ids: ['deal-1'],
        pipelineStageId: 'stage-missing',
        scope: { organizationId: 'org-1', tenantId: 'tenant-1', userId: 'user-1' },
      }),
    ).rejects.toThrow(/Pipeline stage stage-missing does not exist/)

    expect(execute).not.toHaveBeenCalled()
    expect(startJob).not.toHaveBeenCalled()
    expect(completeJob).not.toHaveBeenCalled()
  })

  it('pre-flights stage existence against customer_pipeline_stages (regression: must not query customer_dictionary_entries)', async () => {
    const execute = jest.fn().mockResolvedValue({ result: { dealId: 'deal-1' } })
    const startJob = jest.fn().mockResolvedValue(undefined)
    const updateProgress = jest.fn().mockResolvedValue(undefined)
    const completeJob = jest.fn().mockResolvedValue(undefined)
    const stageExecute = jest.fn().mockResolvedValue([{ id: 'stage-1' }])

    const container = {
      resolve: jest.fn((name: string) => {
        if (name === 'commandBus') return { execute }
        if (name === 'progressService') return { startJob, updateProgress, completeJob }
        if (name === 'em') return { getConnection: () => ({ execute: stageExecute }) }
        return undefined
      }),
    } as unknown as AwilixContainer

    await bulkUpdateDealStageWithProgress({
      container,
      progressJobId: 'job-table-check',
      ids: ['deal-1'],
      pipelineStageId: 'stage-1',
      scope: { organizationId: 'org-1', tenantId: 'tenant-1', userId: 'user-1' },
    })

    expect(stageExecute).toHaveBeenCalledTimes(1)
    const sql = String(stageExecute.mock.calls[0][0])
    expect(sql).toContain('customer_pipeline_stages')
    expect(sql).not.toContain('customer_dictionary_entries')
    expect(stageExecute.mock.calls[0][1]).toEqual(['stage-1', 'tenant-1', 'org-1'])
  })

  it('captures per-failure messages in failedItems for stage updates', async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce({ result: { dealId: 'deal-1' } })
      .mockRejectedValueOnce(new Error('not found'))
    const startJob = jest.fn().mockResolvedValue(undefined)
    const updateProgress = jest.fn().mockResolvedValue(undefined)
    const completeJob = jest.fn().mockResolvedValue(undefined)
    const stageExecute = jest.fn().mockResolvedValue([{ id: 'stage-1' }])
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)

    const container = {
      resolve: jest.fn((name: string) => {
        if (name === 'commandBus') return { execute }
        if (name === 'progressService') return { startJob, updateProgress, completeJob }
        if (name === 'em') return { getConnection: () => ({ execute: stageExecute }) }
        return undefined
      }),
    } as unknown as AwilixContainer

    try {
      const summary = await bulkUpdateDealStageWithProgress({
        container,
        progressJobId: 'job-4',
        ids: ['deal-1', 'deal-2'],
        pipelineStageId: 'stage-1',
        scope: { organizationId: 'org-1', tenantId: 'tenant-1', userId: 'user-1' },
      })

      expect(summary).toEqual({
        affectedCount: 1,
        failedCount: 1,
        failedItems: [{ id: 'deal-2', message: 'not found' }],
      })
    } finally {
      warn.mockRestore()
    }
  })
})
