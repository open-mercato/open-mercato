import { clearDataSyncRepairCell, recordDataSyncRepairCell } from '../repair-cell'

describe('data-sync repair-cell integration', () => {
  it('records a scoped repair cell for a failed delivery', async () => {
    const em = { upsert: jest.fn().mockResolvedValue(undefined) }
    await recordDataSyncRepairCell(em as never, 'progress-1', { tenantId: 'tenant-1', organizationId: 'org-1' }, 'import', 'upstream timeout')
    expect(em.upsert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      jobId: 'progress-1', tenantId: 'tenant-1', organizationId: 'org-1', cell: 'data_sync.import', reason: 'upstream timeout',
    }), expect.anything())
  })

  it('clears the same scoped repair cell after successful delivery', async () => {
    const em = { nativeDelete: jest.fn().mockResolvedValue(1) }
    await clearDataSyncRepairCell(em as never, 'progress-1', { tenantId: 'tenant-1', organizationId: 'org-1' })
    expect(em.nativeDelete).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      jobId: 'progress-1', tenantId: 'tenant-1', organizationId: 'org-1',
    }))
  })
})
