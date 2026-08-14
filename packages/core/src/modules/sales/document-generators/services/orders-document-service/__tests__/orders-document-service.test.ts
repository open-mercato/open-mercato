import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { createTranslator } from '@open-mercato/shared/lib/i18n/translate'
import en from '../../../../i18n/en.json'
import pl from '../../../../i18n/pl.json'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { OrdersDocumentService, type OrderRecord } from '..'

const mockedFind = findOneWithDecryption as jest.Mock

const auth = { tenantId: 't-1', orgId: 'o-1' } as unknown as AuthContext
const container = { resolve: jest.fn(() => ({})) } as unknown as AppContainer
const orderId = '11111111-1111-4111-8111-111111111111'
const templateContext = {
  en: { locale: 'en', translate: createTranslator(en) },
  pl: { locale: 'pl', translate: createTranslator(pl) },
}

function makeOrderRecord(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: 'ord-1',
    orderNumber: 'ORD-2026-0007',
    currencyCode: 'EUR',
    placedAt: new Date('2026-05-09T00:00:00.000Z'),
    expectedDeliveryAt: new Date('2026-05-16T00:00:00.000Z'),
    comments: null,
    grandTotalNetAmount: '200.00',
    grandTotalGrossAmount: '246.00',
    taxTotalAmount: '46.00',
    customerSnapshot: { customer: { displayName: 'Beta GmbH', primaryEmail: 'buyer@beta.test' } },
    billingAddressSnapshot: { addressLine1: 'Hauptstr. 5', city: 'Berlin', postalCode: '10115', country: 'DE' },
    lines: [
      {
        id: 'l-1', name: 'Gadget', description: null, quantity: '4',
        unitPriceNet: '50.00', unitPriceGross: '61.50', totalNetAmount: '200.00',
        totalGrossAmount: '246.00', taxRate: '23', currencyCode: 'EUR',
      },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('OrdersDocumentService.fetchData', () => {
  it('throws when auth context is missing but an id is present (tenant-isolation guard)', async () => {
    const service = new OrdersDocumentService()
    await expect(
      service.fetchData({ data: { id: orderId } }, { container, auth: null }),
    ).rejects.toThrow('Missing auth context')
    expect(mockedFind).not.toHaveBeenCalled()
  })

  it('rejects input without an id before querying the database', async () => {
    const service = new OrdersDocumentService()
    const data = { foo: 'bar' }
    await expect(service.fetchData({ data }, { container, auth })).rejects.toThrow()
    expect(mockedFind).not.toHaveBeenCalled()
  })

  it('rejects a malformed id before querying the database', async () => {
    const service = new OrdersDocumentService()

    await expect(
      service.fetchData({ data: { id: 'not-a-uuid' } }, { container, auth }),
    ).rejects.toThrow()
    expect(mockedFind).not.toHaveBeenCalled()
  })

  it('rejects when the order does not exist or is outside the current scope', async () => {
    const service = new OrdersDocumentService()
    mockedFind.mockResolvedValueOnce(null)

    await expect(
      service.fetchData({ data: { id: orderId } }, { container, auth }),
    ).rejects.toThrow('Order not found or not accessible')
  })

  it('propagates database failures instead of falling back to request data', async () => {
    const service = new OrdersDocumentService()
    const failure = new Error('database unavailable')
    mockedFind.mockRejectedValueOnce(failure)

    await expect(
      service.fetchData({ data: { id: orderId, grandTotalGrossAmount: '0.01' } }, { container, auth }),
    ).rejects.toBe(failure)
  })

  it('scopes the query by id, tenantId and organizationId (C2)', async () => {
    const service = new OrdersDocumentService()
    mockedFind.mockResolvedValueOnce({
      id: orderId, orderNumber: 'ORD-1', currencyCode: 'EUR',
      placedAt: null, expectedDeliveryAt: null, comments: null,
      grandTotalNetAmount: '0', grandTotalGrossAmount: '0', taxTotalAmount: '0',
      customerSnapshot: null, billingAddressSnapshot: { addressLine1: 'x' },
      customerEntityId: null, lines: { getItems: () => [] },
    })

    const result = await service.fetchData({
      data: { id: orderId, grandTotalGrossAmount: '999999.99' },
    }, { container, auth })

    expect(mockedFind).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { id: orderId, tenantId: 't-1', organizationId: 'o-1' },
      { populate: ['lines'] },
    )
    expect(result).toMatchObject({ id: orderId, grandTotalGrossAmount: '0' })
  })
})

describe('OrdersDocumentService.toTemplateData', () => {
  it('normalizes a record with object snapshots', () => {
    const service = new OrdersDocumentService()
    const out = service.toTemplateData({ data: makeOrderRecord(), ...templateContext.pl })

    expect(out.document).toMatchObject({ id: 'ord-1', number: 'ORD-2026-0007' })
    expect((out.document as Record<string, string>).date).toBe('9.05.2026')
    expect(out.client).toMatchObject({ name: 'Beta GmbH', email: 'buyer@beta.test' })
    expect(out.totals).toEqual({ subtotal: 200, tax: 46, total: 246, currency: 'EUR' })
    expect((out.lines as unknown[])).toHaveLength(1)
    expect((out.client as Record<string, string>).address).toContain('Hauptstr. 5')
  })

  it('formats document dates using the required locale', () => {
    const service = new OrdersDocumentService()

    const out = service.toTemplateData({ data: makeOrderRecord(), ...templateContext.en })

    expect(out.document).toMatchObject({ date: '5/9/2026', dueDate: '5/16/2026' })
    expect(out.locale).toBe('en')
  })

  it('builds invoice labels using the active translator', () => {
    const service = new OrdersDocumentService()

    const english = service.toTemplateData({ data: makeOrderRecord(), ...templateContext.en })
    const polish = service.toTemplateData({ data: makeOrderRecord(), ...templateContext.pl })

    expect(english.labels).toMatchObject({ invoice: 'Invoice', amountDue: 'Amount due', notes: 'Notes' })
    expect(polish.labels).toMatchObject({ invoice: 'Faktura', amountDue: 'Do zapłaty', notes: 'Uwagi' })
  })
})

describe('OrdersDocumentService templates', () => {
  it('registers PDF and Markdown variants of the order invoice', async () => {
    const service = new OrdersDocumentService()
    const entries = service.getEntries()

    expect(entries.map((entry) => ({ id: entry.id, format: entry.format }))).toEqual([
      { id: 'sales.order-invoice', format: 'pdf' },
      { id: 'sales.order-invoice-markdown', format: 'md' },
    ])

    const pdf = entries.find((entry) => entry.id === 'sales.order-invoice')
    const markdown = entries.find((entry) => entry.id === 'sales.order-invoice-markdown')
    expect(pdf?.filename({ data: { document: { number: 'ORD-9' } } })).toBe('invoice-ORD-9.pdf')
    expect(pdf?.filename({ data: {} })).toBe('invoice.pdf')
    expect(markdown?.filename({ data: { document: { number: 'ORD-9' } } })).toBe('invoice-ORD-9.md')
    expect(markdown?.filename({ data: {} })).toBe('invoice.md')
    await expect(markdown?.load()).resolves.toMatchObject({ type: 'markdown' })
  })
})

describe('OrdersDocumentService.resourceLabel', () => {
  it('returns the document number as the history label', () => {
    const service = new OrdersDocumentService()
    expect(service.resourceLabel({ data: { document: { number: 'ORD-9' } } })).toBe('ORD-9')
  })

  it('returns undefined when the number is missing', () => {
    const service = new OrdersDocumentService()
    expect(service.resourceLabel({ data: {} })).toBeUndefined()
  })
})

describe('OrdersDocumentService.resourceId', () => {
  it('returns the canonical order id from normalized data', () => {
    const service = new OrdersDocumentService()
    expect(service.resourceId({ data: { document: { id: 'ord-9' } } })).toBe('ord-9')
  })

  it('rejects normalized data without a canonical id', () => {
    const service = new OrdersDocumentService()
    expect(() => service.resourceId({ data: {} })).toThrow('missing document.id')
  })
})
