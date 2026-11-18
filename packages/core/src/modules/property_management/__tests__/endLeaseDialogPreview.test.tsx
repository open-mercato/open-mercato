/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { EndLeaseDialog } from '../components/leases/EndLeaseDialog'
import type { LeaseSummary } from '../components/leases/leaseModel'

type CallResult = { ok: boolean; status: number; result: unknown }
const mockApiCall = jest.fn<Promise<CallResult>, [string, RequestInit?, unknown?]>()
const mockSend = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (url: string, init?: RequestInit, options?: unknown) => mockApiCall(url, init, options),
}))
jest.mock('../components/leases/useLeaseMutation', () => ({ useLeaseMutation: () => ({ send: mockSend }) }))

const LEASE_ID = '77777777-7777-4777-8777-777777777777'

function leaseSummary(): LeaseSummary {
  return {
    id: LEASE_ID, reference: 'L-0007', status: 'active', buildingId: 'b', buildingName: 'HQ', unitId: 'u', unitName: 'U1', floorName: null,
    customerCompanyId: 'c', companyName: 'Acme', primaryContactPersonId: null, contactName: null, startsOn: '2020-01-01', termMonths: 240,
    endsOn: '2039-12-31', daysLeft: 9000, productName: 'Office', monthlyRate: '100', currencyCode: 'EUR', salesOrderId: 'order-1',
    salesOrderNumber: 'SO-1', openProposal: null, pendingChange: null, billingPending: false, billingAttention: false,
    unitUnavailable: false, unitUnavailableFrom: null, unitUnavailableUntil: null, updatedAt: '2026-11-01T00:00:00Z',
  } as LeaseSummary
}

const PREVIEW = {
  defaultSettlement: 'prorate',
  canCredit: true,
  cancelAvailable: true,
  ordersToCancel: 1,
  options: [
    { settlement: 'prorate', wouldCredit: true, allowed: true },
    { settlement: 'credit_full', wouldCredit: true, allowed: true },
    { settlement: 'keep', wouldCredit: false, allowed: true },
  ],
}

function dateInput(): HTMLInputElement {
  return screen.getByLabelText(/Last day of the lease/) as HTMLInputElement
}

function confirmButton(): HTMLElement {
  return screen.getByRole('button', { name: 'End lease' })
}

describe('EndLeaseDialog date default', () => {
  beforeEach(() => {
    mockApiCall.mockReset()
    mockSend.mockReset()
    mockApiCall.mockResolvedValue({ ok: true, status: 200, result: PREVIEW })
  })

  it('defaults the last day to the deployment date from the settings', async () => {
    renderWithProviders(<EndLeaseDialog lease={leaseSummary()} today="2031-03-15" onClose={jest.fn()} onEnded={jest.fn()} />)
    expect(dateInput().value).toBe('2031-03-15')
    await waitFor(() => expect(mockApiCall).toHaveBeenCalledWith(expect.stringContaining('endsOn=2031-03-15'), undefined, undefined))
  })

  it('switches to the deployment date when it arrives, unless the date was edited', async () => {
    const { rerender } = renderWithProviders(<EndLeaseDialog lease={leaseSummary()} today={null} onClose={jest.fn()} onEnded={jest.fn()} />)
    rerender(<EndLeaseDialog lease={leaseSummary()} today="2031-03-15" onClose={jest.fn()} onEnded={jest.fn()} />)
    await waitFor(() => expect(dateInput().value).toBe('2031-03-15'))

    fireEvent.change(dateInput(), { target: { value: '2032-01-31' } })
    rerender(<EndLeaseDialog lease={leaseSummary()} today="2031-03-16" onClose={jest.fn()} onEnded={jest.fn()} />)
    expect(dateInput().value).toBe('2032-01-31')
  })

  it('never defaults past the lease end', () => {
    renderWithProviders(<EndLeaseDialog lease={leaseSummary()} today="2045-01-01" onClose={jest.fn()} onEnded={jest.fn()} />)
    expect(dateInput().value).toBe('2039-12-31')
  })
})

describe('EndLeaseDialog preview for the chosen date', () => {
  beforeEach(() => {
    mockApiCall.mockReset()
    mockSend.mockReset()
  })

  it('does not confirm against the previous date’s options while the new preview loads', async () => {
    let releaseSecond: (value: CallResult) => void = () => undefined
    mockApiCall
      .mockResolvedValueOnce({ ok: true, status: 200, result: PREVIEW })
      .mockImplementationOnce(() => new Promise<CallResult>((resolve) => { releaseSecond = resolve }))
    renderWithProviders(<EndLeaseDialog lease={leaseSummary()} today="2031-03-15" onClose={jest.fn()} onEnded={jest.fn()} />)
    await waitFor(() => expect(confirmButton()).not.toBeDisabled())

    fireEvent.change(dateInput(), { target: { value: '2032-01-31' } })
    expect(confirmButton()).toBeDisabled()
    fireEvent.keyDown(dateInput(), { key: 'Enter', metaKey: true })
    expect(mockSend).not.toHaveBeenCalled()

    releaseSecond({
      ok: true,
      status: 200,
      result: { ...PREVIEW, defaultSettlement: 'keep', options: PREVIEW.options.map((entry) => ({ ...entry, allowed: entry.settlement === 'keep' })) },
    })
    await waitFor(() => expect(confirmButton()).not.toBeDisabled())
    expect(screen.getByRole('radio', { name: /keep/i })).toBeChecked()
  })

  it('stays disabled when the preview for the new date fails', async () => {
    mockApiCall
      .mockResolvedValueOnce({ ok: true, status: 200, result: PREVIEW })
      .mockResolvedValueOnce({ ok: false, status: 500, result: { error: 'Sales is unavailable.' } })
    renderWithProviders(<EndLeaseDialog lease={leaseSummary()} today="2031-03-15" onClose={jest.fn()} onEnded={jest.fn()} />)
    await waitFor(() => expect(confirmButton()).not.toBeDisabled())
    fireEvent.change(dateInput(), { target: { value: '2032-01-31' } })
    expect(await screen.findByTestId('pm-lease-end-preview-error')).toHaveTextContent('Sales is unavailable.')
    expect(confirmButton()).toBeDisabled()
  })
})
