/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { SalesOrder, SalesPayment, SalesPaymentMethod, SalesShipment, SalesShippingMethod } from '../../data/entities'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string) => key }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (em: EntityManager, entity: never, where: never) => em.findOne(entity, where),
  findWithDecryption: (em: EntityManager, entity: never, where: never) => em.find(entity, where),
}))
jest.mock('../shared', () => ({
  ...jest.requireActual('../shared'),
  enforceSalesDocumentOptimisticLock: jest.fn(),
  lockSalesDocumentRow: jest.fn().mockResolvedValue(true),
}))
jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({ emitCrudSideEffects: jest.fn() }))
jest.mock('@open-mercato/shared/lib/crud/cache', () => ({ invalidateCrudCache: jest.fn(), buildRecordTag: jest.fn() }))
jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({ loadCustomFieldValues: jest.fn() }))
jest.mock('@open-mercato/core/modules/entities/lib/helpers', () => ({ setRecordCustomFields: jest.fn() }))
jest.mock('../../../notifications/lib/notificationService', () => ({ resolveNotificationService: jest.fn() }))
jest.mock('../../notifications', () => ({ notificationTypes: [] }))

const tenantId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const organizationId = 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb'
const orderId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const recordId = 'dddddddd-dddd-4ddd-9ddd-dddddddddddd'
const referenceId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const foreignId = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

function setup(reference: Record<string, unknown> | null) {
  const order = { id: orderId, tenantId, organizationId, grandTotalGrossAmount: '100', paidTotalAmount: '0', refundedTotalAmount: '0' }
  const record = { id: recordId, tenantId, organizationId, order, status: 'pending', statusEntryId: null, shippingMethodId: null, paymentMethod: null }
  const findOne = jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
    if (entity === SalesOrder) return order
    if (entity === SalesShipment || entity === SalesPayment) return record
    if (!reference) return null
    return Object.entries(where).every(([key, value]) => reference[key] === value) ? reference : null
  })
  const em = {
    findOne,
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn(), persist: jest.fn(), flush: jest.fn(),
    transactional: async (callback: (tx: unknown) => Promise<unknown>) => callback(em),
  }
  const ctx = {
    auth: { tenantId, orgId: organizationId },
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
    container: { resolve: (key: string) => key === 'em' ? { fork: () => em } : {} },
  } as unknown as CommandRuntimeContext
  return { em, ctx, record }
}

beforeAll(async () => {
  await import('../shipments')
  await import('../payments')
})

describe.each(['shipments', 'payments'])('%s status reference scope', (resource) => {
  describe.each(['create', 'update'])('%s', (operation) => {
    it.each(['tenant', 'organization', 'missing'])('rejects a %s reference before writing', async (foreignScope) => {
      const reference = foreignScope === 'missing' ? null : {
        id: referenceId, tenantId: foreignScope === 'tenant' ? foreignId : tenantId,
        organizationId: foreignScope === 'organization' ? foreignId : organizationId, value: 'foreign',
      }
      const { em, ctx, record } = setup(reference)
      const command = commandRegistry.get(`sales.${resource}.${operation}`)
      expect(command).toBeDefined()
      await expect(command!.execute({
        id: recordId, orderId, tenantId, organizationId, statusEntryId: referenceId,
        amount: 1, currencyCode: 'USD', items: [{ orderLineId: recordId, quantity: 1 }],
        ...(operation === 'update' ? { items: undefined } : {}),
      }, ctx)).rejects.toMatchObject({ status: 400 })
      expect(em.findOne).toHaveBeenCalledWith(DictionaryEntry, { id: referenceId, tenantId, organizationId })
      expect(record.statusEntryId).toBeNull()
      expect(record.status).toBe('pending')
      expect(em.create).not.toHaveBeenCalled()
      expect(em.persist).not.toHaveBeenCalled()
      expect(em.flush).not.toHaveBeenCalled()
    })
  })
})

describe.each([
  ['shipments', SalesShippingMethod, 'shippingMethodId'],
  ['payments', SalesPaymentMethod, 'paymentMethodId'],
] as const)('%s method scope', (resource, entity, field) => {
  describe.each(['create', 'update'])('%s', (operation) => {
    it.each(['tenant', 'organization', 'missing'])('rejects a %s method before writing', async (foreignScope) => {
      const { em, ctx, record } = setup(foreignScope === 'missing' ? null : {
        id: referenceId, tenantId: foreignScope === 'tenant' ? foreignId : tenantId,
        organizationId: foreignScope === 'organization' ? foreignId : organizationId, deletedAt: null,
      })
      await expect(commandRegistry.get(`sales.${resource}.${operation}`)!.execute({
        id: recordId, orderId, tenantId, organizationId, [field]: referenceId,
        amount: 1, currencyCode: 'USD',
        ...(resource === 'shipments' && operation === 'create' ? { items: [{ orderLineId: recordId, quantity: 1 }] } : {}),
      }, ctx)).rejects.toMatchObject({ status: 400 })
      expect(em.findOne).toHaveBeenCalledWith(entity, { id: referenceId, tenantId, organizationId, deletedAt: null })
      expect(record.shippingMethodId).toBeNull()
      expect(record.paymentMethod).toBeNull()
      expect(em.create).not.toHaveBeenCalled()
      expect(em.persist).not.toHaveBeenCalled()
      expect(em.flush).not.toHaveBeenCalled()
    })
  })
})
