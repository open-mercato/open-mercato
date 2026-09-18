/** @jest-environment node */

import type { AwilixContainer } from 'awilix'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SyncCursor } from '@open-mercato/core/modules/data_sync/data/entities'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
  findOneWithDecryption: jest.fn(),
}))

import { deleteImportedProductsWithProgress } from '../lib/delete-imported-products'

const SCOPE = { organizationId: 'org-1', tenantId: 'tenant-1', userId: 'user-1' }

function buildHarness(productIds: string[]) {
  ;(findWithDecryption as jest.Mock).mockResolvedValue(
    productIds.map((id) => ({ internalEntityId: id, createdAt: new Date('2026-08-01') })),
  )

  const em = {
    nativeDelete: jest.fn(async () => 1),
  }
  const resetResumePosition = jest.fn(async () => 1)
  const services: Record<string, unknown> = {
    em,
    commandBus: { execute: jest.fn(async () => ({ productId: 'p' })) },
    progressService: {
      startJob: jest.fn(async () => undefined),
      updateProgress: jest.fn(async () => undefined),
      completeJob: jest.fn(async () => undefined),
    },
    dataSyncRunService: { resetResumePosition },
  }
  const container = { resolve: (key: string) => services[key] } as unknown as AwilixContainer

  return { container, em, resetResumePosition }
}

describe('deleteImportedProductsWithProgress resets both cursor surfaces', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('clears the run-scoped resume position alongside the shared cursor row', async () => {
    const { container, em, resetResumePosition } = buildHarness(['product-1'])

    await deleteImportedProductsWithProgress({ container, progressJobId: 'job-1', scope: SCOPE })

    expect(em.nativeDelete).toHaveBeenCalledWith(SyncCursor, expect.objectContaining({
      integrationId: 'sync_akeneo',
      entityType: 'products',
      direction: 'import',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
    }))
    // Deleting the shared row only resets entity types that write one; without
    // this the reset would leave an interrupted run's cursor as the next start
    // position if the products adapter ever opts out.
    expect(resetResumePosition).toHaveBeenCalledWith('sync_akeneo', 'products', 'import', {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
    })
  })

  it('does not reset anything when there was nothing imported to delete', async () => {
    const { container, em, resetResumePosition } = buildHarness([])

    await deleteImportedProductsWithProgress({ container, progressJobId: 'job-1', scope: SCOPE })

    expect(em.nativeDelete).not.toHaveBeenCalled()
    expect(resetResumePosition).not.toHaveBeenCalled()
  })
})
