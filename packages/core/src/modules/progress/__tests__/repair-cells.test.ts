import { describe, expect, it } from '@jest/globals'
import { acknowledgeRepairCell, claimDueRepairCells, releaseRepairCell, removeRepairCell, upsertRepairCell } from '../lib/repair-cells'

describe('progress repair cells', () => {
  it('rejects an unbounded or empty claim batch', async () => {
    const em = {} as never
    await expect(claimDueRepairCells(em, { tenantId: 't1' }, new Date(), 0)).rejects.toThrow('positive integer')
    await expect(claimDueRepairCells(em, { tenantId: 't1' }, new Date(), 1.5)).rejects.toThrow('positive integer')
    await expect(claimDueRepairCells(em, { tenantId: 't1' }, new Date(), 1, 0)).rejects.toThrow('positive integer')
  })

  it('writes and removes a cell through the tenant-scoped entity API', async () => {
    const created = { getConnection: () => ({ execute: jest.fn().mockResolvedValue(undefined) }) }
    await upsertRepairCell(created as never, {
      jobId: 'j1', tenantId: 't1', organizationId: 'o1', cell: 'lease_expired', dueAt: new Date(0),
    })

    const deleted = { nativeDelete: jest.fn().mockResolvedValue(1) }
    await expect(removeRepairCell(deleted as never, 'j1', { tenantId: 't1', organizationId: 'o1' })).resolves.toBe(true)
    expect(deleted.nativeDelete).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ jobId: 'j1', tenantId: 't1', organizationId: 'o1' }))
  })

  it('leases due cells and requires the lease token for acknowledgement or release', async () => {
    const cell = { jobId: 'j1', attempts: 0 }
    const tx = {
      find: jest.fn().mockResolvedValue([cell]),
      flush: jest.fn().mockResolvedValue(undefined),
    }
    const em = { transactional: jest.fn(async (work: (manager: typeof tx) => Promise<unknown>) => work(tx)) }

    const claim = await claimDueRepairCells(em as never, { tenantId: 't1', organizationId: 'o1' }, new Date(0), 1, 1000)
    expect(claim.cells).toEqual([cell])
    expect(cell.attempts).toBe(1)
    expect(cell.leaseToken).toBe(claim.leaseToken)
    expect(cell.leaseUntil).toEqual(new Date(1000))
    expect(tx.flush).toHaveBeenCalledTimes(1)

    const acknowledged = { nativeDelete: jest.fn().mockResolvedValue(1) }
    await expect(acknowledgeRepairCell(acknowledged as never, 'j1', { tenantId: 't1', organizationId: 'o1' }, claim.leaseToken)).resolves.toBe(true)
    expect(acknowledged.nativeDelete).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ leaseToken: claim.leaseToken }))

    const released = { nativeUpdate: jest.fn().mockResolvedValue(1) }
    await expect(releaseRepairCell(released as never, 'j1', { tenantId: 't1', organizationId: 'o1' }, claim.leaseToken, new Date(2000), 'retry')).resolves.toBe(true)
    expect(released.nativeUpdate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ leaseToken: claim.leaseToken }), expect.objectContaining({ leaseToken: null, leaseUntil: null }))
  })
})
