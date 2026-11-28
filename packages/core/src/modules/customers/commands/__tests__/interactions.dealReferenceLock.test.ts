/** @jest-environment node */

const findWithDecryption = jest.fn()
const findOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryption(...args),
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryption(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { lockInteractionDealReferences, linkedDealIds } from '../shared'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const interactionId = '33333333-3333-4333-8333-333333333333'
const dealA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const dealB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const dealC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

type StoredRow = { deal_id: string | null; linked_entities: unknown }

function createEm(stored: StoredRow | null = null) {
  const calls: Array<{ sql: string; params: unknown[] }> = []
  const execute = jest.fn(async (sql: string, params: unknown[]) => {
    calls.push({ sql, params })
    if (sql.startsWith('select deal_id, linked_entities')) return stored ? [stored] : []
    return []
  })
  return { em: { execute } as unknown as EntityManager, calls }
}

function lockedKeys(calls: Array<{ sql: string; params: unknown[] }>): string[] {
  return calls.filter((call) => call.sql.includes('pg_advisory_xact_lock')).map((call) => String(call.params[0]))
}

function chip(id: string, type = 'deal') {
  return { id, type, label: id.slice(0, 4) }
}

function liveDeals(...ids: string[]) {
  findWithDecryption.mockImplementation(async (_em: unknown, _entity: unknown, where: { id: { $in: string[] } }) =>
    where.id.$in.filter((id) => ids.includes(id)).map((id) => ({ id })))
  findOneWithDecryption.mockImplementation(async (_em: unknown, _entity: unknown, where: { id: string }) =>
    ids.includes(where.id) ? { id: where.id, tenantId, organizationId } : null)
}

describe('lockInteractionDealReferences', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    liveDeals(dealA, dealB, dealC)
  })

  it('collects unique Deal chip ids only', () => {
    expect(linkedDealIds([chip(dealA), chip(dealA), chip(dealB, 'company'), null, 'x'])).toEqual([dealA])
    expect(linkedDealIds(null)).toEqual([])
  })

  it('does nothing when the write references no Deal', async () => {
    const { em, calls } = createEm()
    await lockInteractionDealReferences(em, { dealId: null, linkedEntities: [chip(dealA, 'company')], tenantId, organizationId })
    expect(calls).toEqual([])
  })

  it('locks dealId and every Deal chip in sorted key order before checking they are live', async () => {
    const { em, calls } = createEm()
    await lockInteractionDealReferences(em, {
      dealId: dealC,
      linkedEntities: [chip(dealB), chip(dealA), chip(dealC)],
      tenantId,
      organizationId,
    })
    const keys = lockedKeys(calls)
    expect(keys).toHaveLength(3)
    expect(keys).toEqual([...keys].sort())
    expect(keys.map((key) => key.split(':').pop())).toEqual([dealA, dealB, dealC])
    const lastLock = calls.findLastIndex((call) => call.sql.includes('pg_advisory_xact_lock'))
    expect(lastLock).toBe(2)
    expect(findOneWithDecryption).toHaveBeenCalledWith(em, expect.anything(), expect.objectContaining({ id: dealC, deletedAt: null }), undefined, { tenantId, organizationId })
    expect(findWithDecryption.mock.calls[0][2]).toEqual(expect.objectContaining({ id: { $in: [dealB, dealA, dealC] }, deletedAt: null, tenantId, organizationId }))
  })

  it('rejects a new Deal chip that is no longer live with the Deal-not-found error', async () => {
    liveDeals(dealA)
    const { em } = createEm()
    const error = await lockInteractionDealReferences(em, {
      linkedEntities: [chip(dealA), chip(dealB)],
      tenantId,
      organizationId,
    }).catch((err: unknown) => err)
    expect(error).toBeInstanceOf(CrudHttpError)
    expect((error as CrudHttpError).status).toBe(400)
    expect((error as CrudHttpError).body).toEqual({ error: 'Deal not found' })
  })

  it('rejects a dealId that is no longer live', async () => {
    liveDeals()
    const { em } = createEm()
    await expect(lockInteractionDealReferences(em, { dealId: dealA, tenantId, organizationId }))
      .rejects.toBeInstanceOf(CrudHttpError)
  })

  it('on update re-checks only chips the stored row does not already hold, read after the locks', async () => {
    liveDeals(dealB)
    const { em, calls } = createEm({ deal_id: null, linked_entities: JSON.stringify([chip(dealA)]) })
    await lockInteractionDealReferences(em, {
      linkedEntities: [chip(dealA), chip(dealB)],
      interactionId,
      tenantId,
      organizationId,
    })
    const storedRead = calls.findIndex((call) => call.sql.startsWith('select deal_id, linked_entities'))
    expect(storedRead).toBeGreaterThan(calls.findLastIndex((call) => call.sql.includes('pg_advisory_xact_lock')))
    expect(calls[storedRead].params).toEqual([interactionId, tenantId, organizationId])
    expect(findWithDecryption.mock.calls[0][2].id).toEqual({ $in: [dealB] })
  })

  it('rejects a stale payload that still carries a Deal chip the merge already rewrote', async () => {
    liveDeals(dealB)
    const { em } = createEm({ deal_id: dealB, linked_entities: [chip(dealB)] })
    await expect(lockInteractionDealReferences(em, {
      linkedEntities: [chip(dealA)],
      interactionId,
      tenantId,
      organizationId,
    })).rejects.toBeInstanceOf(CrudHttpError)
  })

  it('on restore keeps an unchanged stored dealId without requiring it to be live', async () => {
    liveDeals()
    const { em } = createEm({ deal_id: dealA, linked_entities: [chip(dealA)] })
    await lockInteractionDealReferences(em, {
      dealId: dealA,
      linkedEntities: [chip(dealA)],
      interactionId,
      tenantId,
      organizationId,
      restore: true,
    })
    expect(findOneWithDecryption).not.toHaveBeenCalled()
    expect(findWithDecryption).not.toHaveBeenCalled()
  })

  it('on restore rejects a dealId that differs from the stored row and is no longer live', async () => {
    liveDeals(dealB)
    const { em } = createEm({ deal_id: dealB, linked_entities: null })
    await expect(lockInteractionDealReferences(em, {
      dealId: dealA,
      interactionId,
      tenantId,
      organizationId,
      restore: true,
    })).rejects.toBeInstanceOf(CrudHttpError)
  })
})
