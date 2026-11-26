import type { EntityManager } from '@mikro-orm/postgresql'
import { entityReferenceLockKey } from '@open-mercato/shared/lib/entities/reference-lock'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

import {
  collectAttachmentDealIds,
  lockAttachmentDealReferences,
  lockLiveAttachmentDealReferences,
} from '../dealReferenceGuard'

const DEAL = 'customers:customer_deal'
const LOCK_SQL = 'select pg_advisory_xact_lock(hashtextextended(?::text, 0))'
const scope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}
const dealA = '33333333-3333-4333-8333-333333333333'
const dealB = '44444444-4444-4444-8444-444444444444'

function buildEm(liveIds: string[]) {
  const execute = jest.fn(async (sql: string, params: string[]) => {
    if (sql === LOCK_SQL) return []
    return liveIds.includes(params[0]) ? [{ '?column?': 1 }] : []
  })
  return { em: { execute } as unknown as EntityManager, execute }
}

describe('attachments Deal reference guard', () => {
  it('collects Deal ids from the owning record and the assignments', () => {
    expect(collectAttachmentDealIds({
      entityId: DEAL,
      recordId: dealA,
      assignments: [
        { type: DEAL, id: dealA },
        { type: DEAL, id: dealB },
        { type: 'customers:customer_person_profile', id: 'person-1' },
      ],
    })).toEqual([dealA, dealB])
    expect(collectAttachmentDealIds({ entityId: 'catalog:catalog_product', recordId: dealA })).toEqual([])
  })

  it('locks every referenced Deal and passes when all are live', async () => {
    const { em, execute } = buildEm([dealA, dealB])
    await expect(lockLiveAttachmentDealReferences(em, [dealA, dealB], scope)).resolves.toBeUndefined()
    const lockedKeys = execute.mock.calls.filter((call) => call[0] === LOCK_SQL).map((call) => call[1][0])
    expect(lockedKeys.sort()).toEqual([
      entityReferenceLockKey({ entityId: DEAL, recordId: dealA, ...scope }),
      entityReferenceLockKey({ entityId: DEAL, recordId: dealB, ...scope }),
    ].sort())
    expect(execute.mock.calls.slice(0, 2).every((call) => call[0] === LOCK_SQL)).toBe(true)
  })

  it('rejects with a 404 when a referenced Deal is gone after the lock', async () => {
    const { em } = buildEm([dealA])
    await expect(lockLiveAttachmentDealReferences(em, [dealA, dealB], scope))
      .rejects.toMatchObject({ status: 404, body: { error: 'Deal not found.' } })
  })

  it('does nothing without Deal references', async () => {
    const { em, execute } = buildEm([])
    await lockLiveAttachmentDealReferences(em, [], scope)
    await lockAttachmentDealReferences(em, [], scope)
    expect(execute).not.toHaveBeenCalled()
  })

  it('takes the lock without a liveness check for lock-only callers', async () => {
    const { em, execute } = buildEm([])
    await lockAttachmentDealReferences(em, [dealA], scope)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledWith(LOCK_SQL, [entityReferenceLockKey({ entityId: DEAL, recordId: dealA, ...scope })])
  })
})
