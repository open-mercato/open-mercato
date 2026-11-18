jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (emInstance: any, entity: unknown, filters: unknown, opts?: unknown) =>
    emInstance.find(entity, filters, opts),
  findOneWithDecryption: (emInstance: any, entity: unknown, filters: unknown, opts?: unknown) =>
    emInstance.findOne(entity, filters, opts),
}))

import '@open-mercato/core/modules/customers/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { CustomFieldValue } from '@open-mercato/core/modules/entities/data/entities'
import { CustomerDeal } from '../../data/entities'

const DEAL_ID = '550e8400-e29b-41d4-a716-446655440000'
const DEAL_ENTITY_ID = 'customers:customer_deal'

function makeDeal(): CustomerDeal {
  return {
    id: DEAL_ID,
    organizationId: 'org-1',
    tenantId: 'tenant-1',
    title: 'Expansion renewal',
    description: null,
    status: 'open',
    pipelineStage: 'Discovery',
    pipelineId: null,
    pipelineStageId: null,
    valueAmount: '12000',
    valueCurrency: 'USD',
    probability: 65,
    expectedCloseAt: null,
    ownerUserId: null,
    source: 'Referral',
    closureOutcome: null,
    lossReasonId: null,
    lossNotes: null,
    deletedAt: null,
  } as unknown as CustomerDeal
}

function makeEm(deal: CustomerDeal | null) {
  const em: any = {
    findOne: jest.fn(async (ctor: unknown, where: Record<string, unknown>) =>
      ctor === CustomerDeal && deal && where.id === deal.id ? deal : null,
    ),
    find: jest.fn(async () => []),
    nativeDelete: jest.fn(async () => 0),
    create: jest.fn((_ctor: unknown, payload: Record<string, unknown>) => ({ ...payload })),
    persist: jest.fn(),
    remove: jest.fn(),
    flush: jest.fn(async () => {}),
    transactional: jest.fn(async (fn: (inner: any) => Promise<unknown>) => fn(em)),
    begin: jest.fn(async () => {}),
    commit: jest.fn(async () => {}),
    rollback: jest.fn(async () => {}),
    getReference: jest.fn((_ctor: unknown, id: string) => ({ id })),
  }
  em.fork = jest.fn(() => em)
  return em
}

function makeCtx(em: any) {
  const queue: any[] = []
  const engine: any = {
    setCustomFields: jest.fn(async () => {}),
    emitOrmEntityEvent: jest.fn(async () => {}),
    markOrmEntityChange: jest.fn((entry: any) => {
      if (entry?.entity) queue.push(entry)
    }),
    flushOrmEntityChanges: jest.fn(async () => {
      while (queue.length > 0) await engine.emitOrmEntityEvent(queue.shift())
    }),
  }
  const ctx = {
    container: {
      resolve: (token: string) => {
        if (token === 'em') return em
        if (token === 'dataEngine') return engine
        if (token === 'eventBus') return undefined
        throw new Error(`Unexpected dependency: ${token}`)
      },
    } as any,
    auth: { sub: '550e8400-e29b-41d4-a716-446655440099', tenantId: 'tenant-1', orgId: 'org-1' } as any,
    selectedOrganizationId: 'org-1',
    organizationScope: null,
    organizationIds: null,
    request: undefined as any,
  }
  return { ctx, engine }
}

describe('customers.deals.delete custom field cleanup', () => {
  const handler = () => commandRegistry.get('customers.deals.delete') as CommandHandler

  it('removes the deal custom field values together with the deal', async () => {
    const deal = makeDeal()
    const em = makeEm(deal)
    const { ctx } = makeCtx(em)

    await handler().execute!({ body: { id: DEAL_ID } }, ctx)

    expect(em.nativeDelete).toHaveBeenCalledWith(CustomFieldValue, {
      entityId: DEAL_ENTITY_ID,
      recordId: DEAL_ID,
    })
    expect(em.remove).toHaveBeenCalledWith(deal)
  })

  it('leaves custom field values untouched when the deal does not exist', async () => {
    const em = makeEm(null)
    const { ctx } = makeCtx(em)

    await expect(handler().execute!({ body: { id: DEAL_ID } }, ctx)).rejects.toBeDefined()

    expect(em.nativeDelete).not.toHaveBeenCalledWith(CustomFieldValue, expect.anything())
  })

  it('restores the deleted custom field values on undo', async () => {
    const em = makeEm(null)
    const { ctx, engine } = makeCtx(em)
    const before = {
      deal: makeDeal(),
      people: [],
      primaryPersonEntityId: null,
      companies: [],
      transitions: [],
      custom: { priority: 'high' },
    }

    await handler().undo!({
      logEntry: { resourceId: DEAL_ID, commandPayload: { undo: { before } } },
      ctx,
    } as any)

    expect(engine.setCustomFields).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: DEAL_ENTITY_ID,
        recordId: DEAL_ID,
        values: expect.objectContaining({ priority: 'high' }),
      }),
    )
  })
})
