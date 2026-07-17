/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { SalesCreditMemo, SalesOrder } from '../data/entities'

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const ORDER_ID = '33333333-3333-4333-8333-333333333333'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string) => key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async () => ({ id: ORDER_ID })),
  findWithDecryption: jest.fn(async () => []),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(async () => ({})),
  setRecordCustomFields: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/shared/lib/commands/flush', () => ({
  withAtomicFlush: async (_em: unknown, phases: Array<() => unknown | Promise<unknown>>) => {
    for (const phase of phases) await phase()
  },
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/commands/helpers'),
  emitCrudSideEffects: jest.fn(async () => undefined),
  emitCrudUndoSideEffects: jest.fn(async () => undefined),
}))

describe('sales.credit_memos.create order link', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../commands/documents')
  })

  it('persists the validated order id through the SalesCreditMemo relation property', async () => {
    const orderReference = { id: ORDER_ID }
    let createdCreditMemo: Record<string, unknown> | null = null
    const em = {
      fork() {
        return this
      },
      findOne: jest.fn(async () => null),
      getReference: jest.fn((entity: unknown, id: string) => {
        expect(entity).toBe(SalesOrder)
        expect(id).toBe(ORDER_ID)
        return orderReference
      }),
      create: jest.fn((entity: unknown, data: Record<string, unknown>) => {
        if (entity === SalesCreditMemo) createdCreditMemo = data
        return data
      }),
      persist: jest.fn(),
      flush: jest.fn(async () => undefined),
    }
    const ctx = {
      container: {
        resolve: (key: string) => {
          if (key === 'em') return em
          if (key === 'dataEngine') return { markOrmEntityChange: jest.fn() }
          if (key === 'salesDocumentNumberGenerator') {
            return { generate: jest.fn(async () => ({ number: 'CM-1' })) }
          }
          throw new Error(`Unregistered test dependency: ${key}`)
        },
      },
      auth: { tenantId: TENANT_ID, orgId: ORGANIZATION_ID, sub: 'user-1', isSuperAdmin: true },
      selectedOrganizationId: ORGANIZATION_ID,
      organizationScope: null,
      organizationIds: [ORGANIZATION_ID],
    }

    const handler = commandRegistry.get('sales.credit_memos.create')
    expect(handler).toBeTruthy()
    await handler!.execute({
      organizationId: ORGANIZATION_ID,
      tenantId: TENANT_ID,
      orderId: ORDER_ID,
      creditMemoNumber: 'CM-1',
      currencyCode: 'USD',
    }, ctx as never)

    expect(em.getReference).toHaveBeenCalledWith(SalesOrder, ORDER_ID)
    expect(createdCreditMemo).toMatchObject({ order: orderReference })
    expect(createdCreditMemo).not.toHaveProperty('orderId')
  })

  it('reads the order link into delete snapshots through the relation property', async () => {
    const creditMemoRow = {
      id: 'cm-1',
      organizationId: ORGANIZATION_ID,
      tenantId: TENANT_ID,
      creditMemoNumber: 'CM-1',
      order: { id: ORDER_ID },
      invoiceId: null,
      statusEntryId: null,
      status: null,
      reason: null,
      issueDate: null,
      currencyCode: 'USD',
      subtotalNetAmount: '0',
      subtotalGrossAmount: '0',
      taxTotalAmount: '0',
      grandTotalNetAmount: '0',
      grandTotalGrossAmount: '0',
      metadata: null,
      customFieldSetId: null,
      deletedAt: null,
      updatedAt: new Date(),
    }
    const em = {
      fork() {
        return this
      },
      findOne: jest.fn(async (entity: unknown) => (entity === SalesCreditMemo ? creditMemoRow : null)),
      find: jest.fn(async () => []),
      getReference: jest.fn((entity: unknown, id: string) => ({ entity, id })),
      create: jest.fn((_entity: unknown, data: Record<string, unknown>) => data),
      persist: jest.fn(),
      flush: jest.fn(async () => undefined),
    }
    const ctx = {
      container: {
        resolve: (key: string) => {
          if (key === 'em') return em
          if (key === 'dataEngine') return { markOrmEntityChange: jest.fn() }
          throw new Error(`Unregistered test dependency: ${key}`)
        },
      },
      auth: { tenantId: TENANT_ID, orgId: ORGANIZATION_ID, sub: 'user-1', isSuperAdmin: true },
      selectedOrganizationId: ORGANIZATION_ID,
      organizationScope: null,
      organizationIds: [ORGANIZATION_ID],
    }

    const handler = commandRegistry.get('sales.credit_memos.delete')
    expect(handler).toBeTruthy()
    const prepared = await handler!.prepare!({ id: 'cm-1' }, ctx as never) as {
      before?: { creditMemo?: { orderId?: string | null } }
    }
    expect(prepared.before?.creditMemo?.orderId).toBe(ORDER_ID)
  })
})
