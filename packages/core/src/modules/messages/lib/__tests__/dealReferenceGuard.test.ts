import type { EntityManager } from '@mikro-orm/postgresql'
import { entityReferenceLockKey } from '@open-mercato/shared/lib/entities/reference-lock'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

import { collectMessageDealIds, lockLiveMessageDealReferences, lockMessageDealReferences } from '../dealReferenceGuard'

const LOCK_SQL = 'select pg_advisory_xact_lock(hashtextextended(?::text, 0))'
const scope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}
const dealId = '33333333-3333-4333-8333-333333333333'

function buildEm(live: boolean) {
  const execute = jest.fn(async (sql: string) => (sql === LOCK_SQL ? [] : live ? [{ '?column?': 1 }] : []))
  return { em: { execute } as unknown as EntityManager, execute }
}

describe('messages Deal reference guard', () => {
  it('collects only customers deal objects', () => {
    expect(collectMessageDealIds([
      { entityModule: 'customers', entityType: 'deal', entityId: dealId },
      { entityModule: 'customers', entityType: 'deal', entityId: dealId },
      { entityModule: 'customers', entityType: 'person', entityId: 'person-1' },
      { entityModule: 'sales', entityType: 'deal', entityId: 'other' },
    ])).toEqual([dealId])
  })

  it('locks the Deal before checking that it is live', async () => {
    const { em, execute } = buildEm(true)
    await lockLiveMessageDealReferences(em, [dealId], scope)
    expect(execute).toHaveBeenNthCalledWith(1, LOCK_SQL, [
      entityReferenceLockKey({ entityId: 'customers:customer_deal', recordId: dealId, ...scope }),
    ])
    expect(execute).toHaveBeenNthCalledWith(2, expect.stringContaining('from customer_deals'), [
      dealId,
      scope.tenantId,
      scope.organizationId,
    ])
  })

  it('rejects with a 404 when the Deal is gone', async () => {
    const { em } = buildEm(false)
    await expect(lockLiveMessageDealReferences(em, [dealId], scope))
      .rejects.toMatchObject({ status: 404, body: { error: 'Deal not found.' } })
  })

  it('skips messages without an organization scope, which a Deal merge never rewrites', async () => {
    const { em, execute } = buildEm(false)
    await lockLiveMessageDealReferences(em, [dealId], { tenantId: scope.tenantId, organizationId: null })
    await lockMessageDealReferences(em, [dealId], { tenantId: scope.tenantId, organizationId: null })
    expect(execute).not.toHaveBeenCalled()
  })
})
