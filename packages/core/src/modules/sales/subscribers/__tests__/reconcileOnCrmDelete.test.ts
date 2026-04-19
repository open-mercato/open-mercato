import { SalesOrder, SalesQuote } from '@open-mercato/core/modules/sales/data/entities'
import reconcileOnCustomerDelete, { metadata as personMeta } from '@open-mercato/core/modules/sales/subscribers/reconcileOnCustomerDelete'
import reconcileOnCompanyDelete, { metadata as companyMeta } from '@open-mercato/core/modules/sales/subscribers/reconcileOnCompanyDelete'
import reconcileOnAddressDelete, { metadata as addressMeta } from '@open-mercato/core/modules/sales/subscribers/reconcileOnAddressDelete'

type NativeUpdateCall = { entity: unknown; where: Record<string, unknown>; data: Record<string, unknown> }

function makeEm() {
  const calls: NativeUpdateCall[] = []
  const em = {
    nativeUpdate: async (entity: unknown, where: Record<string, unknown>, data: Record<string, unknown>) => {
      calls.push({ entity, where, data })
      return 1
    },
  }
  return { em, calls }
}

function makeCtx(em: unknown) {
  return { resolve: <T = unknown>(name: string): T => (name === 'em' ? (em as T) : (undefined as unknown as T)) }
}

describe('sales reconcile subscribers on CRM delete', () => {
  test('person subscriber is persistent and wires to customers.person.deleted', () => {
    expect(personMeta.event).toBe('customers.person.deleted')
    expect(personMeta.persistent).toBe(true)
    expect(personMeta.id).toBe('sales:reconcile-on-person-delete')
  })

  test('company subscriber is persistent and wires to customers.company.deleted', () => {
    expect(companyMeta.event).toBe('customers.company.deleted')
    expect(companyMeta.persistent).toBe(true)
    expect(companyMeta.id).toBe('sales:reconcile-on-company-delete')
  })

  test('address subscriber is persistent and wires to customers.address.deleted', () => {
    expect(addressMeta.event).toBe('customers.address.deleted')
    expect(addressMeta.persistent).toBe(true)
    expect(addressMeta.id).toBe('sales:reconcile-on-address-delete')
  })

  test('person delete nulls customerEntityId on orders and quotes, scoped by tenant', async () => {
    const { em, calls } = makeEm()
    const entityId = '00000000-0000-0000-0000-000000000001'
    const tenantId = '00000000-0000-0000-0000-000000000002'
    await reconcileOnCustomerDelete({ entityId, id: 'some-profile-id', tenantId }, makeCtx(em))

    expect(calls).toHaveLength(2)
    const orderCall = calls.find((c) => c.entity === SalesOrder)
    const quoteCall = calls.find((c) => c.entity === SalesQuote)
    expect(orderCall?.where).toEqual({ customerEntityId: entityId, tenantId })
    expect(orderCall?.data).toEqual({ customerEntityId: null })
    expect(quoteCall?.where).toEqual({ customerEntityId: entityId, tenantId })
    expect(quoteCall?.data).toEqual({ customerEntityId: null })
  })

  test('person delete falls back to payload.id when entityId is missing', async () => {
    const { em, calls } = makeEm()
    const legacyId = '00000000-0000-0000-0000-000000000003'
    await reconcileOnCustomerDelete({ id: legacyId, tenantId: 'tenant-1' }, makeCtx(em))
    expect(calls.every((c) => c.where.customerEntityId === legacyId)).toBe(true)
  })

  test('person delete is a no-op when entityId or tenantId missing', async () => {
    const { em, calls } = makeEm()
    await reconcileOnCustomerDelete({ tenantId: 't' }, makeCtx(em))
    await reconcileOnCustomerDelete({ entityId: 'e' }, makeCtx(em))
    await reconcileOnCustomerDelete(null, makeCtx(em))
    expect(calls).toHaveLength(0)
  })

  test('company delete nulls customerEntityId on orders and quotes', async () => {
    const { em, calls } = makeEm()
    await reconcileOnCompanyDelete({ entityId: 'company-1', tenantId: 'tenant-1' }, makeCtx(em))
    expect(calls.map((c) => c.entity).sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)))).toEqual(
      [SalesOrder, SalesQuote].sort((a: any, b: any) => String(a.name).localeCompare(String(b.name))),
    )
  })

  test('address delete nulls both billing and shipping references on orders and quotes', async () => {
    const { em, calls } = makeEm()
    const addressId = '00000000-0000-0000-0000-000000000100'
    const tenantId = '00000000-0000-0000-0000-000000000200'
    await reconcileOnAddressDelete({ id: addressId, tenantId }, makeCtx(em))

    expect(calls).toHaveLength(4)
    const billingOrder = calls.find(
      (c) => c.entity === SalesOrder && 'billingAddressId' in (c.where as any),
    )
    const shippingOrder = calls.find(
      (c) => c.entity === SalesOrder && 'shippingAddressId' in (c.where as any),
    )
    const billingQuote = calls.find(
      (c) => c.entity === SalesQuote && 'billingAddressId' in (c.where as any),
    )
    const shippingQuote = calls.find(
      (c) => c.entity === SalesQuote && 'shippingAddressId' in (c.where as any),
    )

    expect(billingOrder?.where).toEqual({ billingAddressId: addressId, tenantId })
    expect(billingOrder?.data).toEqual({ billingAddressId: null })
    expect(shippingOrder?.where).toEqual({ shippingAddressId: addressId, tenantId })
    expect(shippingOrder?.data).toEqual({ shippingAddressId: null })
    expect(billingQuote?.where).toEqual({ billingAddressId: addressId, tenantId })
    expect(billingQuote?.data).toEqual({ billingAddressId: null })
    expect(shippingQuote?.where).toEqual({ shippingAddressId: addressId, tenantId })
    expect(shippingQuote?.data).toEqual({ shippingAddressId: null })
  })

  test('address delete is a no-op when id or tenantId missing', async () => {
    const { em, calls } = makeEm()
    await reconcileOnAddressDelete({ tenantId: 't' }, makeCtx(em))
    await reconcileOnAddressDelete({ id: 'a' }, makeCtx(em))
    expect(calls).toHaveLength(0)
  })

  test('swallows errors so a failing reconcile does not break the event bus', async () => {
    const errorEm = {
      nativeUpdate: async () => {
        throw new Error('db down')
      },
    }
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    await expect(
      reconcileOnAddressDelete({ id: 'addr-1', tenantId: 't' }, makeCtx(errorEm)),
    ).resolves.toBeUndefined()
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
