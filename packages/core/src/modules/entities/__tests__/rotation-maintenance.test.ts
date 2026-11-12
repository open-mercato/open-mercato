import { readMaintenanceBatches, writeMaintenanceRow, verifyMaintenanceBatch, MAINTENANCE_BATCH_SIZE } from '../lib/rotation-maintenance'

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
  test('protected writes read committed values back and reject persistence-side changes', async () => {
    const execute = jest.fn().mockResolvedValueOnce([{ id: 1 }]).mockResolvedValueOnce([])
    await expect(writeMaintenanceRow({ execute }, '"records"', ['id'], { id: 1, value: 'before' }, { value: 'after' }, scope, true)).rejects.toThrow('readback')
    expect(execute.mock.calls[1][0]).toContain('SELECT "id" FROM "records"')
    expect(execute.mock.calls[1][1]).toEqual([1, 'tenant-a', null, 'after'])
  })
  test('protected callers can select a preflight-proven bounded batch while invalid limits refuse', async () => {
    const execute = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 1 }])
    for await (const _batch of readMaintenanceBatches({ execute }, '"records"', ['value'], ['id'], scope, 45)) {}
    expect(execute.mock.calls[1][0]).toContain('LIMIT 45')
    await expect((async () => { for await (const _batch of readMaintenanceBatches({ execute }, '"records"', ['value'], ['id'], scope, 501)) {} })()).rejects.toThrow('batch size')
  })
  test('one committed readback checks the complete batch and refuses an omitted row', async () => {
    const execute = jest.fn().mockResolvedValueOnce([{ verified: '2' }]).mockResolvedValueOnce([{ verified: '1' }])
    const writes = [{ row: { id: 1 }, updates: { value: 'first' } }, { row: { id: 2 }, updates: { value: 'second' } }]
    await verifyMaintenanceBatch({ execute }, '"records"', ['id'], writes, scope)
    expect(execute.mock.calls[0][1]).toEqual(['tenant-a', null, 1, 'first', 2, 'second'])
    await expect(verifyMaintenanceBatch({ execute }, '"records"', ['id'], writes, scope)).rejects.toThrow('batch')
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
