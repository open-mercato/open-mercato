import { readMaintenanceBatches, writeMaintenanceRow, MAINTENANCE_BATCH_SIZE } from '../lib/rotation-maintenance'

const scope = { tenantId: 'tenant-a', organizationId: null }
describe('bounded scoped maintenance', () => {
  test('walks every component of a composite key across batches', async () => {
    const first = Array.from({ length: MAINTENANCE_BATCH_SIZE }, (_, n) => ({ shard: 'a', id: n }))
    const execute = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(first).mockResolvedValueOnce([{ shard: 'b', id: 0 }])
    const batches = []
    for await (const rows of readMaintenanceBatches({ execute }, '"records"', ['value'], ['shard', 'id'], scope)) batches.push(rows)
    expect(batches.flat()).toHaveLength(MAINTENANCE_BATCH_SIZE + 1)
    expect(execute.mock.calls[2][0]).toContain('("shard", "id") > (?, ?)')
    expect(execute.mock.calls[2][1]).toEqual(['tenant-a', null, 'a', MAINTENANCE_BATCH_SIZE - 1])
  })
  test('refuses oversized data before fetching row contents', async () => {
    const execute = jest.fn().mockResolvedValue([{ oversized: 1 }])
    await expect((async () => { for await (const _rows of readMaintenanceBatches({ execute }, '"records"', ['value'], ['id'], scope)) {} })()).rejects.toThrow('byte limit')
    expect(execute).toHaveBeenCalledTimes(1)
  })
  test('scoped compare-and-swap includes complete identity and previous values', async () => {
    const execute = jest.fn().mockResolvedValue([{ id: 1 }])
    await writeMaintenanceRow({ execute }, '"records"', ['shard', 'id'], { shard: 's', id: 1, value: 'before' }, { value: 'after' }, scope)
    expect(execute.mock.calls[0][0]).toContain('"shard" = ? AND "id" = ? AND tenant_id = ?')
    expect(execute.mock.calls[0][1]).toEqual(['after', 's', 1, 'tenant-a', null, 'before'])
    execute.mockResolvedValue([])
    await expect(writeMaintenanceRow({ execute }, '"records"', ['id'], { id: 1, value: 'before' }, { value: 'after' }, scope)).rejects.toThrow('changed concurrently')
  })
})
