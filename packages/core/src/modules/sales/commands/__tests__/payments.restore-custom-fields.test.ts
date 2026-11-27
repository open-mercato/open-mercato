/** @jest-environment node */

import { setRecordCustomFields } from '@open-mercato/core/modules/entities/lib/helpers'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string) => key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn().mockResolvedValue(null),
  findWithDecryption: jest.fn().mockResolvedValue([]),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn().mockResolvedValue({}),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  emitCrudSideEffects: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@open-mercato/core/modules/entities/lib/helpers', () => ({
  setRecordCustomFields: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../../../notifications/lib/notificationService', () => ({
  resolveNotificationService: jest.fn().mockReturnValue({
    createForFeature: jest.fn().mockResolvedValue(undefined),
  }),
}))

jest.mock('../../notifications', () => ({
  notificationTypes: [],
}))

jest.mock('../../lib/dictionaries', () => ({
  resolveDictionaryEntryValue: jest.fn().mockResolvedValue(null),
}))

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const ORG_ID = 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb'
const ORDER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const PAYMENT_ID = 'dddddddd-dddd-4ddd-9ddd-dddddddddddd'
const ALLOCATION_ID = 'eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee'
const STALE_ALLOCATION_ID = 'ffffffff-ffff-4fff-afff-ffffffffffff'

describe('restorePaymentSnapshot custom fields (issue #6449)', () => {
  it('writes snapshot custom fields under their definition keys, not cf_-prefixed', async () => {
    const { restorePaymentSnapshot } = await import('../payments')
    const em = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
      persist: jest.fn(),
      remove: jest.fn(),
      flush: jest.fn().mockResolvedValue(undefined),
      getReference: jest.fn((_entity: unknown, id: string) => ({ id })),
    }

    await restorePaymentSnapshot(em as any, {
      id: PAYMENT_ID,
      orderId: ORDER_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      paymentMethodId: null,
      paymentReference: null,
      statusEntryId: null,
      status: null,
      amount: 10,
      currencyCode: 'USD',
      allocations: [],
      customFields: { cf_bank_ref: 'B-1', cf_tags: ['a', 'b'] },
    } as any)

    expect(setRecordCustomFields).toHaveBeenCalledTimes(1)
    expect((setRecordCustomFields as jest.Mock).mock.calls[0][1].values).toEqual({
      bank_ref: 'B-1',
      tags: ['a', 'b'],
    })
  })

  it('purges stale allocation custom fields and restores each allocation under its original id (issue #8068)', async () => {
    const { restorePaymentSnapshot } = await import('../payments')
    const em = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([{ id: STALE_ALLOCATION_ID }]),
      create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
      persist: jest.fn(),
      remove: jest.fn(),
      nativeDelete: jest.fn().mockResolvedValue(0),
      flush: jest.fn().mockResolvedValue(undefined),
      getReference: jest.fn((_entity: unknown, id: string) => ({ id })),
    }

    const { findWithDecryption } = await import('@open-mercato/shared/lib/encryption/find')
    ;(findWithDecryption as jest.Mock).mockResolvedValueOnce([{ id: STALE_ALLOCATION_ID }])

    await restorePaymentSnapshot(em as any, {
      id: PAYMENT_ID,
      orderId: ORDER_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      paymentMethodId: null,
      paymentReference: null,
      statusEntryId: null,
      status: null,
      amount: 10,
      currencyCode: 'USD',
      allocations: [
        {
          id: ALLOCATION_ID,
          orderId: ORDER_ID,
          invoiceId: null,
          amount: 10,
          currencyCode: 'USD',
          metadata: null,
          customFields: { priority: 'high' },
        },
      ],
    } as any)

    expect(em.nativeDelete).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ recordId: { $in: [STALE_ALLOCATION_ID] } }),
    )
    const allocationCreateCall = (em.create as jest.Mock).mock.calls.find(
      (args: unknown[]) => (args[1] as Record<string, unknown>)?.amount !== undefined,
    )
    expect(allocationCreateCall?.[1]).toMatchObject({ id: ALLOCATION_ID })
    const allocationCustomFieldsCall = (setRecordCustomFields as jest.Mock).mock.calls.find(
      (args: unknown[]) => (args[1] as Record<string, unknown>)?.recordId === ALLOCATION_ID,
    )
    expect(allocationCustomFieldsCall?.[1]).toMatchObject({ values: { priority: 'high' } })
  })
})
