import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createTranslator } from '@open-mercato/shared/lib/i18n/translate'
import { SalesChannel, SalesQuote, SalesQuoteLine } from '../../../../data/entities'
import { QuotesDocumentService, type QuoteDocumentSource } from '../quotes-document-service'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

const findOneMock = findOneWithDecryption as jest.Mock
const findMock = findWithDecryption as jest.Mock

const QUOTE_ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const ORG_ID = '33333333-3333-4333-8333-333333333333'
const CHANNEL_ID = '44444444-4444-4444-8444-444444444444'

function buildContext(auth: { tenantId: string | null; orgId: string | null } | null = { tenantId: TENANT_ID, orgId: ORG_ID }) {
  const em = { fork: jest.fn() }
  em.fork.mockReturnValue(em)
  const container = { resolve: jest.fn().mockReturnValue(em) }
  return { em, context: { container, auth } as never }
}

function buildQuote(overrides: Record<string, unknown> = {}) {
  return {
    id: QUOTE_ID,
    quoteNumber: 'Q-100',
    currencyCode: 'EUR',
    channelId: CHANNEL_ID,
    customerSnapshot: {
      customer: { displayName: 'Acme Ltd', primaryEmail: 'info@acme.test', companyProfile: { legalName: 'Acme Legal' } },
      contact: { firstName: 'Ann', lastName: 'Lee', email: 'ann@acme.test' },
    },
    billingAddressSnapshot: JSON.stringify({
      companyName: 'Acme Billing',
      addressLine1: 'Main St',
      buildingNumber: '5',
      flatNumber: '2',
      postalCode: '00-001',
      city: 'Warsaw',
      country: 'PL',
    }),
    placedAt: null,
    createdAt: new Date('2026-01-02T10:00:00.000Z'),
    validUntil: new Date('2026-02-01T00:00:00.000Z'),
    comments: ' Thanks ',
    subtotalNetAmount: '100.00',
    taxTotalAmount: '23.00',
    grandTotalGrossAmount: '123.00',
    ...overrides,
  }
}

const quoteLine = {
  lineNumber: 1,
  name: 'Widget',
  description: 'Blue widget',
  quantity: '2',
  currencyCode: 'EUR',
  unitPriceNet: '50.00',
  unitPriceGross: '61.50',
  totalNetAmount: '100.00',
  totalGrossAmount: '123.00',
}

describe('QuotesDocumentService', () => {
  const service = new QuotesDocumentService()

  beforeEach(() => {
    findOneMock.mockReset()
    findMock.mockReset()
  })

  it('exposes identity and registers the offer template', () => {
    expect(service.id).toBe('quotes')
    expect(service.module).toBe('sales')
    expect(service.resourceKind).toBe('sales.quote')
    expect(service.getEntries().map((entry) => entry.id)).toEqual(['sales.offer'])
  })

  it.each([[undefined], [{}], [{ id: 'not-a-uuid' }], [{ id: 42 }], [null]])(
    'rejects invalid request data %j with 400',
    async (data) => {
      const { context } = buildContext()
      await expect(service.fetchData({ data }, context)).rejects.toMatchObject({ status: 400 })
      expect(findOneMock).not.toHaveBeenCalled()
    },
  )

  it.each([
    [null],
    [{ tenantId: null, orgId: ORG_ID }],
    [{ tenantId: TENANT_ID, orgId: null }],
  ])('fails closed without full auth scope %j', async (auth) => {
    const { context } = buildContext(auth)
    await expect(service.fetchData({ data: { id: QUOTE_ID } }, context)).rejects.toMatchObject({ status: 403 })
    expect(findOneMock).not.toHaveBeenCalled()
  })

  it('scopes every lookup from auth and ignores scope fields in request data', async () => {
    const { context } = buildContext()
    findOneMock.mockImplementation(async (_em, entity) => (entity === SalesQuote ? buildQuote() : null))
    findMock.mockResolvedValue([quoteLine])
    await service.fetchData(
      { data: { id: QUOTE_ID, tenantId: 'evil', organizationId: 'evil' } },
      context,
    )
    const scope = { tenantId: TENANT_ID, organizationId: ORG_ID }
    const quoteCall = findOneMock.mock.calls.find(([, entity]) => entity === SalesQuote)
    expect(quoteCall[2]).toEqual({ id: QUOTE_ID, ...scope, deletedAt: null })
    expect(quoteCall[4]).toEqual(scope)
    const channelCall = findOneMock.mock.calls.find(([, entity]) => entity === SalesChannel)
    expect(channelCall[2]).toEqual({ id: CHANNEL_ID, ...scope, deletedAt: null })
    expect(channelCall[4]).toEqual(scope)
    const linesCall = findMock.mock.calls[0]
    expect(linesCall[1]).toBe(SalesQuoteLine)
    expect(linesCall[2]).toEqual({ quote: QUOTE_ID, ...scope, deletedAt: null })
    expect(linesCall[3]).toEqual({ orderBy: { lineNumber: 'asc' } })
    expect(linesCall[4]).toEqual(scope)
  })

  it('returns 404 when the quote is not visible in the caller scope', async () => {
    const { context } = buildContext()
    findOneMock.mockResolvedValue(null)
    await expect(service.fetchData({ data: { id: QUOTE_ID } }, context)).rejects.toMatchObject({ status: 404 })
    expect(findMock).not.toHaveBeenCalled()
  })

  it('omits the channel when the quote has none', async () => {
    const { context } = buildContext()
    findOneMock.mockResolvedValue(buildQuote({ channelId: null }))
    findMock.mockResolvedValue([])
    const source = await service.fetchData({ data: { id: QUOTE_ID } }, context)
    expect(source.channel).toBeNull()
    expect(findOneMock).toHaveBeenCalledTimes(1)
  })

  describe('toTemplateData', () => {
    const translate = createTranslator({ 'sales.documents.templates.offer.labels.title': 'Oferta' })
    const source: QuoteDocumentSource = {
      quote: {
        id: QUOTE_ID,
        quoteNumber: 'Q-100',
        currencyCode: 'EUR',
        customerSnapshot: buildQuote().customerSnapshot,
        billingAddressSnapshot: buildQuote().billingAddressSnapshot,
        placedAt: null,
        createdAt: '2026-01-02T10:00:00.000Z',
        validUntil: '2026-02-01T00:00:00.000Z',
        comments: ' Thanks ',
        subtotalNetAmount: '100.00',
        taxTotalAmount: '23.00',
        grandTotalGrossAmount: '123.00',
      },
      lines: [
        { ...quoteLine },
        { ...quoteLine, lineNumber: 2, name: null, description: '  ', quantity: 'abc', unitPriceNet: '', totalNetAmount: '5.5' },
      ],
      channel: { name: 'Web shop', contactEmail: 'shop@example.test', contactPhone: null },
    }

    it('normalizes client, address, lines, totals, dates and notes', () => {
      const result = service.toTemplateData({ data: source, locale: 'pl', translate })
      expect(result.locale).toBe('pl')
      expect(result.document).toEqual({
        id: QUOTE_ID,
        number: 'Q-100',
        date: '2026-01-02T10:00:00.000Z',
        validUntil: '2026-02-01T00:00:00.000Z',
      })
      expect(result.client).toEqual({
        name: 'Acme Ltd',
        email: 'ann@acme.test',
        company: 'Acme Billing',
        address: 'Main St 5/2, 00-001 Warsaw, PL',
      })
      expect(result.lines[0]).toEqual({
        title: 'Widget',
        description: 'Blue widget',
        quantity: 2,
        unitPrice: 50,
        total: 100,
        currency: 'EUR',
      })
      expect(result.lines[1]).toMatchObject({ title: '', description: undefined, quantity: 0, unitPrice: 0, total: 5.5 })
      expect(result.totals).toEqual({ subtotal: 105.5, adjustments: -5.5, tax: 23, total: 123, currency: 'EUR' })
      expect(result.notes).toBe('Thanks')
      expect(result.seller).toEqual({ name: 'Web shop', email: 'shop@example.test', phone: undefined })
    })

    it('translates labels with English defaults', () => {
      const result = service.toTemplateData({ data: source, locale: 'pl', translate })
      expect(result.labels.title).toBe('Oferta')
      expect(result.labels.grandTotal).toBe('Total due')
      expect(Object.keys(result.labels)).toHaveLength(16)
      expect(result.labels.draftWatermark).toBe('DRAFT')
    })

    it('derives the draft watermark from the server-side status', () => {
      const draftOf = (status: string | null) => service.toTemplateData({
        data: { ...source, quote: { ...source.quote, status } },
        locale: 'en',
        translate,
      }).isDraft
      expect(draftOf('draft')).toBe(true)
      expect(draftOf('pending_approval')).toBe(true)
      expect(draftOf(null)).toBe(true)
      expect(draftOf('sent')).toBe(false)
      expect(draftOf('confirmed')).toBe(false)
      expect(draftOf('custom_status')).toBe(false)
    })

    it('omits seller, validUntil and parses string customer snapshots', () => {
      const result = service.toTemplateData({
        data: {
          ...source,
          channel: null,
          quote: {
            ...source.quote,
            validUntil: null,
            placedAt: '2026-01-05T00:00:00.000Z',
            customerSnapshot: JSON.stringify({ contact: { firstName: 'Ann', lastName: 'Lee' } }),
            billingAddressSnapshot: null,
          },
        },
        locale: 'en',
        translate,
      })
      expect(result.seller).toBeUndefined()
      expect(result.document.validUntil).toBeUndefined()
      expect(result.document.date).toBe('2026-01-05T00:00:00.000Z')
      expect(result.client).toEqual({ name: 'Ann Lee', email: undefined, company: undefined, address: undefined })
    })

    it('rejects malformed source data', () => {
      expect(() => service.toTemplateData({ data: { foo: 1 }, locale: 'en', translate })).toThrow()
    })
  })

  it('derives canonical resource id and label from normalized data', () => {
    const data = { document: { id: QUOTE_ID, number: 'Q-100' } }
    expect(service.resourceId({ data })).toBe(QUOTE_ID)
    expect(service.resourceLabel({ data })).toBe('Q-100')
    expect(service.resourceLabel({ data: { document: {} } })).toBeUndefined()
  })
})
