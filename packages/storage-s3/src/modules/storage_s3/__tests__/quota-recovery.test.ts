/** @jest-environment node */

const mockListObjects = jest.fn(async () => ({ files: [], truncated: false }))
const mockScheduleRecovery = jest.fn(async () => {})

jest.mock('../lib/s3-driver', () => ({
  S3StorageDriver: jest.fn().mockImplementation(() => ({
    listObjects: mockListObjects,
    deleteStrict: jest.fn(async () => {}),
  })),
}))

jest.mock('../lib/quota-recovery-queue', () => ({
  scheduleStorageS3QuotaRecovery: mockScheduleRecovery,
}))

import handle from '../workers/quota-recovery'
import { S3StorageDriver } from '../lib/s3-driver'

function reservation(status: 'storing' | 'recovering') {
  return {
    id: 'reservation-1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    reservedBytes: 3,
    actualBytes: null,
    status,
    source: 'storage_s3_signed',
    storageDriver: 's3',
    partitionCode: null,
    storagePath: 'uploads/org_org-1/tenant_tenant-1/safe.pdf',
    leaseToken: 'lease-1',
    uploadTokenHash: 'token-hash',
    expiresAt: new Date(Date.now() - 1_000),
  }
}

describe('storage_s3 quota recovery', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('retains capacity and rechecks once when an active proxy upload has no visible object yet', async () => {
    const current = reservation('storing')
    const claimed = { ...reservation('recovering'), expiresAt: new Date(Date.now() + 60_000) }
    const quotaService = {
      getReservation: jest.fn(async () => current),
      claimExpired: jest.fn(async () => claimed),
      release: jest.fn(async () => {}),
      commitRecoveredStandalone: jest.fn(async () => {}),
    }
    const ctx = {
      resolve: (name: string) => {
        if (name === 'attachmentQuotaService') return quotaService
        if (name === 'integrationCredentialsService') {
          return { resolve: jest.fn(async () => ({ bucket: 'bucket', region: 'us-east-1' })) }
        }
        throw new Error(`Unexpected dependency: ${name}`)
      },
    }

    const payload = {
      reservationId: current.id,
      tenantId: current.tenantId,
      organizationId: current.organizationId,
    }
    await handle({ payload, id: 'job-1' } as never, ctx as never)

    expect(quotaService.getReservation).toHaveBeenCalledWith(current.id, {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(S3StorageDriver).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 'org-1',
      tenantId: 'tenant-1',
    }))
    expect(mockScheduleRecovery).toHaveBeenCalledWith(
      { ...payload, absenceCheck: 1 },
      expect.any(Number),
    )
    expect(quotaService.release).not.toHaveBeenCalled()
  })
})
