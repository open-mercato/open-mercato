import { describe, expect, it } from '@jest/globals'
import { claimDueRepairCells, removeRepairCell, upsertRepairCell } from '../lib/repair-cells'

describe('progress repair cells', () => {
  it('rejects an unbounded or empty claim batch', async () => {
    const em = {} as never
    await expect(claimDueRepairCells(em, { tenantId: 't1' }, new Date(), 0)).rejects.toThrow('positive integer')
    await expect(claimDueRepairCells(em, { tenantId: 't1' }, new Date(), 1.5)).rejects.toThrow('positive integer')
  })

  it('writes and removes a cell through the tenant-scoped entity API', async () => {
    const created = { upsert: jest.fn().mockResolvedValue(undefined) }
    await upsertRepairCell(created as never, {
      jobId: 'j1', tenantId: 't1', organizationId: 'o1', cell: 'lease_expired', dueAt: new Date(0),
    })
    expect(created.upsert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ jobId: 'j1', tenantId: 't1' }), { onConflictAction: 'merge' })

    const deleted = { nativeDelete: jest.fn().mockResolvedValue(1) }
    await expect(removeRepairCell(deleted as never, 'j1', { tenantId: 't1', organizationId: 'o1' })).resolves.toBe(true)
    expect(deleted.nativeDelete).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ jobId: 'j1', tenantId: 't1', organizationId: 'o1' }))
  })
})
