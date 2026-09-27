/**
 * @jest-environment jsdom
 *
 * The panel exists to let an operator read and file an invoice without issuing one, so
 * the assertions are about what it shows (the hashes and the XML), what it does with
 * them (copy, download) and what it says when the invoice cannot be built.
 */
import * as React from 'react'
import '@testing-library/jest-dom'
import { render, screen, waitFor } from '@testing-library/react'
import { fireEvent } from '@testing-library/dom'
import ZatcaInvoicePreviewWidget from '../widget.client'

const apiCallMock = jest.fn()
const flashMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => flashMock(...args),
}))

const mockTranslate = (key: string, fallback?: string) => fallback ?? key
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => mockTranslate }))

const ORDER_ID = '3cf5ee18-ee25-44ea-a444-2c37ba7f28be'
const XML = '<Invoice><cbc:ID>SO-2026-0001</cbc:ID></Invoice>'

const readyResult = {
  status: 'ready' as const,
  invoiceNumber: 'SO-2026-0001',
  icv: 7,
  previousInvoiceHash: 'PREVIOUS_HASH==',
  invoiceHash: 'INVOICE_HASH==',
  qrPayload: 'AQRBQ01F',
  xml: XML,
}

/** jsdom in this setup has no `Response`, and the widget only reads `ok`/`status`/`result`. */
const stubResponse = {} as unknown as Response

const okResponse = (result: unknown) => ({ ok: true, status: 200, result, response: stubResponse, cacheStatus: null })

const renderWidget = (data: Record<string, unknown> = { id: ORDER_ID }) =>
  render(<ZatcaInvoicePreviewWidget context={undefined} data={data as never} />)

const preview = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Preview invoice' }))
  await waitFor(() => expect(apiCallMock).toHaveBeenCalled())
}

describe('ZatcaInvoicePreviewWidget', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    apiCallMock.mockResolvedValue(okResponse(readyResult))
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: jest.fn(async () => undefined) },
    })
    globalThis.URL.createObjectURL = jest.fn(() => 'blob:invoice')
    globalThis.URL.revokeObjectURL = jest.fn()
  })

  it('renders nothing without an order id', () => {
    const { container } = renderWidget({})

    expect(container).toBeEmptyDOMElement()
  })

  it('asks the preview endpoint for exactly this order, and only when clicked', async () => {
    renderWidget()

    expect(apiCallMock).not.toHaveBeenCalled()
    await preview()

    const [url, init] = apiCallMock.mock.calls[0]
    expect(url).toBe('/api/saudi_localization/zatca/invoice-preview')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ orderId: ORDER_ID })
  })

  it('shows the counters, the hashes and the invoice XML', async () => {
    renderWidget()
    await preview()

    expect(await screen.findByText(/Invoice counter value: 7/)).toBeInTheDocument()
    expect(screen.getByText('PREVIOUS_HASH==')).toBeInTheDocument()
    expect(screen.getByText('INVOICE_HASH==')).toBeInTheDocument()
    expect(screen.getByText('UBL 2.1 invoice XML')).toBeInTheDocument()
    expect(screen.getByText(XML)).toBeInTheDocument()
  })

  it('copies the XML to the clipboard and says so', async () => {
    renderWidget()
    await preview()
    await screen.findByText(XML)

    fireEvent.click(screen.getByRole('button', { name: 'Copy XML' }))

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(XML))
    expect(flashMock).toHaveBeenCalledWith('Invoice XML copied.', 'success')
  })

  it('reports a browser that cannot copy instead of failing silently', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: jest.fn(async () => { throw new Error('denied') }) },
    })
    renderWidget()
    await preview()
    await screen.findByText(XML)

    fireEvent.click(screen.getByRole('button', { name: 'Copy XML' }))

    await waitFor(() =>
      expect(flashMock).toHaveBeenCalledWith('Copying is not available in this browser.', 'error'),
    )
  })

  it('downloads the XML under the invoice number', async () => {
    renderWidget()
    await preview()
    await screen.findByText(XML)

    fireEvent.click(screen.getByRole('button', { name: 'Download XML' }))

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:invoice')
  })

  it('explains each reason an invoice cannot be built', async () => {
    for (const status of ['settings_incomplete', 'qr_disabled', 'missing_invoice_data'] as const) {
      apiCallMock.mockResolvedValue(okResponse({ status }))
      const { unmount } = renderWidget()
      await preview()

      await waitFor(() =>
        expect(
          screen.getByText(
            status === 'settings_incomplete'
              ? 'VAT settings are incomplete'
              : status === 'qr_disabled'
                ? 'The ZATCA QR code is turned off'
                : 'This order cannot be invoiced yet',
          ),
        ).toBeInTheDocument(),
      )
      expect(screen.queryByRole('button', { name: 'Copy XML' })).toBeNull()
      unmount()
    }
  })

  it('surfaces the error the endpoint reported', async () => {
    apiCallMock.mockResolvedValue({
      ok: false,
      status: 422,
      result: { error: 'The order has no placement or creation timestamp to invoice.' },
      response: stubResponse,
      cacheStatus: null,
    })
    renderWidget()
    await preview()

    expect(await screen.findByText('The preview could not be built')).toBeInTheDocument()
    expect(screen.getByText('The order has no placement or creation timestamp to invoice.')).toBeInTheDocument()
  })
})
