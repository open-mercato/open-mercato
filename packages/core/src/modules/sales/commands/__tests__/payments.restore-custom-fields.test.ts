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
})
