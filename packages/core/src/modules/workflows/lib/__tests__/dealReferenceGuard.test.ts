import type { EntityManager } from '@mikro-orm/postgresql'
import { entityReferenceLockKey } from '@open-mercato/shared/lib/entities/reference-lock'
import { collectTaskDealIds, lockLiveTaskDealBindings } from '../dealReferenceGuard'

const LOCK_SQL = 'select pg_advisory_xact_lock(hashtextextended(?::text, 0))'
const scope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}
const liveDeal = '33333333-3333-4333-8333-333333333333'
const goneDeal = '44444444-4444-4444-8444-444444444444'

function buildEm() {
  const execute = jest.fn(async (sql: string, params: string[]) => {
    if (sql === LOCK_SQL) return []
    return params[0] === liveDeal ? [{ '?column?': 1 }] : []
  })
  return { em: { execute } as unknown as EntityManager, execute }
}

describe('workflows Deal reference guard', () => {
  it('collects Deal ids through every alias spelling', () => {
    expect(collectTaskDealIds([
      { entityType: 'customers:deal', entityId: liveDeal },
      { entityType: 'customers:customer_deal', entityId: goneDeal },
      { entityType: 'customers:person', entityId: 'person-1' },
    ])).toEqual([liveDeal, goneDeal])
  })

  it('locks bound Deals and keeps live bindings untouched', async () => {
    const { em, execute } = buildEm()
    const bindings = [
      { entityType: 'customers:deal', entityId: liveDeal },
      { entityType: 'customers:person', entityId: 'person-1' },
    ]
    await expect(lockLiveTaskDealBindings(em, bindings, scope)).resolves.toEqual({ bindings, droppedDealIds: [] })
    expect(execute).toHaveBeenNthCalledWith(1, LOCK_SQL, [
      entityReferenceLockKey({ entityId: 'customers:customer_deal', recordId: liveDeal, ...scope }),
    ])
  })

  it('drops only the binding whose Deal is gone after the lock', async () => {
    const { em } = buildEm()
    const result = await lockLiveTaskDealBindings(em, [
      { entityType: 'customers:deal', entityId: liveDeal },
      { entityType: 'customers:deal', entityId: goneDeal },
      { entityType: 'customers:person', entityId: goneDeal },
    ], scope)
    expect(result.droppedDealIds).toEqual([goneDeal])
    expect(result.bindings).toEqual([
      { entityType: 'customers:deal', entityId: liveDeal },
      { entityType: 'customers:person', entityId: goneDeal },
    ])
  })

  it('takes no lock when nothing binds a Deal', async () => {
    const { em, execute } = buildEm()
    await lockLiveTaskDealBindings(em, [{ entityType: 'customers:person', entityId: 'person-1' }], scope)
    expect(execute).not.toHaveBeenCalled()
  })
})
