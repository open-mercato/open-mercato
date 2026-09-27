const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const orderId = '44444444-4444-4444-8444-444444444444'

const getRecordMock = jest.fn()
const setValueMock = jest.fn()
const loadZatcaOrderSourceMock = jest.fn()

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'moduleConfigService') {
      return {
        getRecord: (...args: unknown[]) => getRecordMock(...args),
        setValue: (...args: unknown[]) => setValueMock(...args),
      }
    }
    if (name === 'em') return { fake: 'entity-manager' }
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

let authValue: Record<string, unknown> | null = { tenantId, sub: userId, orgId: organizationId }

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => authValue),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string, fallback?: string) => fallback ?? key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

jest.mock('../../../../lib/zatca/sales-order-source', () => ({
  loadZatcaOrderSource: (...args: unknown[]) => loadZatcaOrderSourceMock(...args),
}))

import { POST } from '../route'
import { computeInvoiceHash } from '../../../../lib/zatca/hash'

const completeSettings = {
  sellerName: 'Apex Trading Est.',
  vatRegistrationNumber: '310122393500003',
  commercialRegistrationNumber: '1010101010',
  vatRate: 0.15,
  invoiceQrEnabled: true,
}

const vatSettingsRecord = (value: unknown) => ({
  moduleId: 'saudi_localization',
  name: 'vat',
  value,
  tenantId,
  organizationId,
  source: 'tenant' as const,
  createdAt: '2026-01-31T09:15:00.000Z',
  updatedAt: '2026-01-31T09:15:00.000Z',
})

const chainRecord = (value: unknown) => ({
  moduleId: 'saudi_localization',
  name: 'zatca_chain',
  value,
  tenantId,
  organizationId,
  source: 'tenant' as const,
  createdAt: '2026-01-31T09:15:00.000Z',
  updatedAt: '2026-01-31T09:15:00.000Z',
})

/** The config store holds both keys, and a route that confuses them must fail. */
function stubConfigStore(options: { settings?: unknown; chain?: unknown } = {}) {
  getRecordMock.mockImplementation(async (_moduleId: string, key: string) => {
    if (key === 'vat') return vatSettingsRecord(options.settings ?? completeSettings)
    if (key === 'zatca_chain') return options.chain ? chainRecord(options.chain) : null
    return null
  })
}

const orderSource = (overrides: Record<string, unknown> = {}) => ({
  orderNumber: 'SO-2026-0001',
  placedAt: '2026-01-31T09:15:00.000Z',
  currencyCode: 'SAR',
  taxTotalAmount: '15.0000',
  grandTotalGrossAmount: '115.0000',
  lines: [
    {
      lineNumber: 1,
      name: 'Office chair',
      quantity: '2',
      quantityUnit: 'PCE',
      unitPriceNet: '50.0000',
      taxRate: '15',
      taxAmount: '15.0000',
      totalNetAmount: '100.0000',
    },
  ],
  ...overrides,
})

const makeRequest = (body: unknown) =>
  new Request('http://localhost/api/saudi_localization/zatca/invoice-preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('ZATCA invoice preview route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    authValue = { tenantId, sub: userId, orgId: organizationId }
    stubConfigStore()
    loadZatcaOrderSourceMock.mockResolvedValue(orderSource())
  })

  it('returns the document, the hash and the QR payload for a ready order', async () => {
    const response = await POST(makeRequest({ orderId }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      status: 'ready',
      preview: true,
      chainMutated: false,
      invoiceNumber: 'SO-2026-0001',
      icv: 1,
    })
    expect(body.invoiceHash).toMatch(/^[A-Za-z0-9+/]{86}==$/)
    expect(body.xml).toContain('<cbc:ID>SO-2026-0001</cbc:ID>')
    expect(body.xml).toContain(body.qrPayload)
    expect(body.preHashXml).not.toContain('<cbc:ID>QR</cbc:ID>')
  })

  it('never touches the invoice chain: no counter is claimed and no hash is stored', async () => {
    const first = await (await POST(makeRequest({ orderId }))).json()
    const second = await (await POST(makeRequest({ orderId }))).json()

    expect(setValueMock).not.toHaveBeenCalled()
    // Identical answers prove the second call did not consume the counter the first
    // one showed, which is the whole point of peeking.
    expect(second).toEqual(first)
  })

  it('points at the previous invoice when the chain already has entries', async () => {
    const previousHash = computeInvoiceHash('<Invoice>previous</Invoice>')
    stubConfigStore({ chain: { icv: 4, lastInvoiceHash: previousHash } })

    const body = await (await POST(makeRequest({ orderId }))).json()

    expect(body.icv).toBe(5)
    expect(body.previousInvoiceHash).toBe(previousHash)
    expect(body.xml).toContain(previousHash)
    expect(setValueMock).not.toHaveBeenCalled()
  })

  it('reports incomplete VAT settings instead of inventing a seller', async () => {
    stubConfigStore({ settings: { ...completeSettings, vatRegistrationNumber: '' } })

    const body = await (await POST(makeRequest({ orderId }))).json()

    expect(body).toMatchObject({ status: 'settings_incomplete', preview: true, chainMutated: false })
    expect(loadZatcaOrderSourceMock).not.toHaveBeenCalled()
  })

  it('refuses a simplified invoice while the QR code is off, and allows a standard one', async () => {
    stubConfigStore({ settings: { ...completeSettings, invoiceQrEnabled: false } })

    const simplified = await (await POST(makeRequest({ orderId }))).json()
    expect(simplified).toMatchObject({ status: 'qr_disabled', preview: true })

    const standard = await (await POST(makeRequest({ orderId, subtype: 'standard' }))).json()
    expect(standard.status).toBe('ready')
    expect(standard.xml).not.toContain('<cbc:ID>QR</cbc:ID>')
  })

  it('answers 404 when the order is not in this organization', async () => {
    loadZatcaOrderSourceMock.mockResolvedValue(null)

    const response = await POST(makeRequest({ orderId }))

    expect(response.status).toBe(404)
    expect((await response.json()).error).toBe('Sales order not found')
  })

  it('reports an order with no lines as missing invoice data', async () => {
    loadZatcaOrderSourceMock.mockResolvedValue(orderSource({ lines: [] }))

    const body = await (await POST(makeRequest({ orderId }))).json()

    expect(body).toMatchObject({ status: 'missing_invoice_data', preview: true, chainMutated: false })
  })

  it('requires a tenant and an organization', async () => {
    authValue = null
    expect((await POST(makeRequest({ orderId }))).status).toBe(401)

    authValue = { tenantId, sub: userId }
    const response = await POST(makeRequest({ orderId }))

    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('Organization context is required')
  })

  it('rejects a body that is not an order id', async () => {
    expect((await POST(makeRequest({ orderId: 'not-a-uuid' }))).status).toBe(400)
  })

  it('answers 422 with the reason a malformed invoice cannot be built', async () => {
    loadZatcaOrderSourceMock.mockResolvedValue(orderSource({ placedAt: null, createdAt: null }))

    const response = await POST(makeRequest({ orderId }))

    expect(response.status).toBe(422)
    expect((await response.json()).code).toBe('invalid_timestamp')
  })
})
