import {
  creditMemoCreateSchema,
  invoiceCreateSchema,
  orderLineCreateSchema,
  quoteLineCreateSchema,
} from '../validators'

const SCOPE = {
  organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
}

const QUOTE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const ORDER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const SERVICE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

describe('sales service line validators', () => {
  it('accepts quote service lines with nullable product fields and a service snapshot', () => {
    const result = quoteLineCreateSchema.safeParse({
      ...SCOPE,
      quoteId: QUOTE_ID,
      kind: 'service',
      productId: null,
      productVariantId: null,
      serviceId: SERVICE_ID,
      name: 'Implementation workshop',
      quantity: 1,
      currencyCode: 'EUR',
      unitPriceNet: 1200,
      unitPriceGross: 1200,
      catalogSnapshot: {
        service: {
          id: SERVICE_ID,
          title: 'Implementation workshop',
          workRequirements: [
            {
              targetType: 'staff_role',
              labelSnapshot: 'Designer',
              allocationMode: 'ratio',
              allocationValue: '1',
            },
          ],
        },
      },
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.kind).toBe('service')
      expect(result.data.productId).toBeNull()
      expect(result.data.serviceId).toBe(SERVICE_ID)
    }
  })

  it('accepts order service lines after quote conversion', () => {
    const result = orderLineCreateSchema.safeParse({
      ...SCOPE,
      orderId: ORDER_ID,
      kind: 'service',
      serviceId: SERVICE_ID,
      productId: null,
      productVariantId: null,
      name: 'Implementation workshop',
      quantity: 1,
      currencyCode: 'EUR',
      unitPriceNet: 1200,
      unitPriceGross: 1200,
    })

    expect(result.success).toBe(true)
  })

  it('preserves service identifiers on invoice and credit memo line payloads', () => {
    const invoiceResult = invoiceCreateSchema.safeParse({
      ...SCOPE,
      invoiceNumber: 'INV-THOM-18',
      currencyCode: 'EUR',
      lines: [
        {
          kind: 'service',
          serviceId: SERVICE_ID,
          quantity: 1,
          currencyCode: 'EUR',
          unitPriceNet: 1200,
          unitPriceGross: 1200,
        },
      ],
    })
    const creditMemoResult = creditMemoCreateSchema.safeParse({
      ...SCOPE,
      creditMemoNumber: 'CM-THOM-18',
      currencyCode: 'EUR',
      lines: [
        {
          kind: 'service',
          serviceId: SERVICE_ID,
          quantity: 1,
          currencyCode: 'EUR',
          unitPriceNet: 1200,
          unitPriceGross: 1200,
        },
      ],
    })

    expect(invoiceResult.success).toBe(true)
    expect(creditMemoResult.success).toBe(true)
  })
})
