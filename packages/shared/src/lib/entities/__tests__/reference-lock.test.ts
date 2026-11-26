import type { EntityManager } from '@mikro-orm/postgresql'
import {
  entityReferenceLockKey,
  lockLiveEntityReference,
  lockLiveEntityReferences,
  scopedLiveRecordCheck,
} from '../reference-lock'

const LOCK_SQL = 'select pg_advisory_xact_lock(hashtextextended(?::text, 0))'

const reference = {
  entityId: 'example:record',
  recordId: '11111111-1111-4111-8111-111111111111',
  tenantId: '22222222-2222-4222-8222-222222222222',
  organizationId: '33333333-3333-4333-8333-333333333333',
}

function buildEm(live: boolean) {
  const execute = jest.fn(async (sql: string) => {
    if (sql === LOCK_SQL) return []
    return live ? [{ '?column?': 1 }] : []
  })
  return { em: { execute } as unknown as EntityManager, execute }
}

describe('lockLiveEntityReference', () => {
  it('takes the reference lock before checking that the record is live', async () => {
    const { em, execute } = buildEm(true)
    await expect(lockLiveEntityReference(em, reference, scopedLiveRecordCheck('example_records'))).resolves.toBe(true)
    expect(execute).toHaveBeenNthCalledWith(1, LOCK_SQL, [entityReferenceLockKey(reference)])
    expect(execute).toHaveBeenNthCalledWith(
      2,
      'select 1 from example_records where id = ? and tenant_id = ? and organization_id = ? and deleted_at is null limit 1',
      [reference.recordId, reference.tenantId, reference.organizationId],
    )
  })

  it('reports a record that is gone after the lock', async () => {
    const { em, execute } = buildEm(false)
    await expect(lockLiveEntityReference(em, reference, scopedLiveRecordCheck('example_records'))).resolves.toBe(false)
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('locks every reference in key order before checking each distinct one once', async () => {
    const { em, execute } = buildEm(true)
    const second = { ...reference, recordId: '00000000-0000-4000-8000-000000000000' }
    await expect(lockLiveEntityReferences(em, [reference, second, reference], scopedLiveRecordCheck('example_records')))
      .resolves.toEqual([])
    expect(execute.mock.calls.map((call) => call[0] === LOCK_SQL ? 'lock' : 'check')).toEqual(['lock', 'lock', 'check', 'check'])
    expect(execute.mock.calls[0][1]).toEqual([entityReferenceLockKey(second)])
  })

  it('builds the same lock key for any letter case of the ids', () => {
    expect(entityReferenceLockKey({
      ...reference,
      recordId: reference.recordId.toUpperCase(),
      tenantId: reference.tenantId.toUpperCase(),
      organizationId: reference.organizationId.toUpperCase(),
    })).toBe(entityReferenceLockKey(reference))
  })

  it('reports a non-uuid record id as missing without querying the table', async () => {
    const { em, execute } = buildEm(true)
    await expect(lockLiveEntityReference(em, { ...reference, recordId: 'not-a-uuid' }, scopedLiveRecordCheck('example_records')))
      .resolves.toBe(false)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledWith(LOCK_SQL, [expect.any(String)])
  })

  it('rejects table names that are not plain identifiers', () => {
    expect(() => scopedLiveRecordCheck('records; drop table x')).toThrow('[internal]')
  })
})
