/**
 * @jest-environment jsdom
 *
 * The panel exists to tell an operator what is wrong with an invoice's QR code,
 * so the assertions are about which message appears for which status — plus the
 * promise that a rendering failure never hides the payload ZATCA expects.
 */
import * as React from 'react'
import '@testing-library/jest-dom'
import { render, screen, waitFor } from '@testing-library/react'
import ZatcaQrWidget from '../widget.client'

const toDataUrlMock = jest.fn(async () => 'data:image/png;base64,QR')

jest.mock('qrcode', () => ({
  __esModule: true,
  default: { toDataURL: (...args: unknown[]) => toDataUrlMock(...args) },
}))

const mockTranslate = (key: string, fallback?: string) => fallback ?? key
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => mockTranslate }))

const PAYLOAD = 'AQRBQ01F'

const readyRecord = {
  id: 'order-1',
  grandTotalGrossAmount: '115.0000',
  placedAt: '2026-01-31T09:15:00.000Z',
  _saudi_localization: { zatcaQrPayload: PAYLOAD, zatcaQrStatus: 'ready' as const },
}

const renderWith = (data: Record<string, unknown> | undefined) =>
  render(<ZatcaQrWidget context={undefined} data={data as never} />)

describe('ZatcaQrWidget', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    toDataUrlMock.mockResolvedValue('data:image/png;base64,QR')
  })

  it('draws the payload and shows it as text next to the totals', async () => {
    renderWith(readyRecord)

    const image = await screen.findByAltText('ZATCA e-invoice QR code')
    expect(image).toHaveAttribute('src', 'data:image/png;base64,QR')
    expect(toDataUrlMock).toHaveBeenCalledWith(PAYLOAD, expect.objectContaining({ width: expect.any(Number) }))
    expect(screen.getByText(PAYLOAD)).toBeInTheDocument()
    expect(screen.getByText(/Total including VAT/)).toBeInTheDocument()
  })

  it('shows the issue date in both calendars', async () => {
    renderWith(readyRecord)

    await screen.findByAltText('ZATCA e-invoice QR code')

    // `ar-SA` renders the Hijri year in Arabic-Indic digits (see the Intl lesson).
    expect(screen.getByText(/١٤٤٧/)).toBeInTheDocument()
  })

  it('renders nothing when the enricher did not run for this caller', () => {
    const { container } = renderWith({ id: 'order-1' })

    expect(container).toBeEmptyDOMElement()
  })

  it('points an operator at the settings screen while the identity is incomplete', () => {
    renderWith({ ...readyRecord, _saudi_localization: { zatcaQrPayload: null, zatcaQrStatus: 'settings_incomplete' } })

    expect(screen.getByText('VAT settings are incomplete')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open VAT settings' })).toBeInTheDocument()
  })

  it('explains a switched-off QR code', () => {
    renderWith({ ...readyRecord, _saudi_localization: { zatcaQrPayload: null, zatcaQrStatus: 'qr_disabled' } })

    expect(screen.getByText('The ZATCA QR code is turned off')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open VAT settings' })).toBeInTheDocument()
  })

  it('explains an order that has no totals to encode', () => {
    renderWith({ id: 'order-1', _saudi_localization: { zatcaQrPayload: null, zatcaQrStatus: 'missing_invoice_data' } })

    expect(screen.getByText('This order cannot be encoded yet')).toBeInTheDocument()
  })

  it('keeps the payload visible when the image cannot be drawn', async () => {
    toDataUrlMock.mockRejectedValue(new Error('[internal] canvas unavailable'))

    renderWith(readyRecord)

    await waitFor(() => expect(screen.getByText('The code could not be drawn')).toBeInTheDocument())
    expect(screen.getByText(PAYLOAD)).toBeInTheDocument()
  })
})
