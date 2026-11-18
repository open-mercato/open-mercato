/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { EndLeaseDialog } from '../components/leases/EndLeaseDialog'
import { ExtendLeaseDialog } from '../components/leases/ExtendLeaseDialog'
import type { LeaseSummary } from '../components/leases/leaseModel'

type CallResult = { ok: boolean; status: number; result: unknown }
const mockApiCall = jest.fn<Promise<CallResult>, [string, RequestInit?, unknown?]>()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (url: string, init?: RequestInit, options?: unknown) => mockApiCall(url, init, options),
}))
jest.mock('../components/leases/useLeaseMutation', () => ({ useLeaseMutation: () => ({ send: jest.fn() }) }))

const LEASE_ID = '44444444-4444-4444-8444-444444444444'

function leaseSummary(): LeaseSummary {
  return {
    id: LEASE_ID, reference: 'L-0002', status: 'active', buildingId: 'b', buildingName: 'HQ', unitId: 'u', unitName: 'U1', floorName: null,
    customerCompanyId: 'c', companyName: 'Acme', primaryContactPersonId: null, contactName: null, startsOn: '2020-01-01', termMonths: 120,
    endsOn: '2099-12-31', daysLeft: 9000, productName: 'Office', monthlyRate: '100', currencyCode: 'EUR', salesOrderId: 'order-1',
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

describe('lease dialogs while the lease page polls', () => {
  beforeEach(() => {
    mockApiCall.mockReset()
    mockApiCall.mockResolvedValue({ ok: true, status: 200, result: PREVIEW })
  })

  it('keeps the End lease date and settlement when a same-id lease object arrives', async () => {
    const { rerender } = renderWithProviders(<EndLeaseDialog lease={leaseSummary()} onClose={jest.fn()} onEnded={jest.fn()} />)
    await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(1))
    const dateInput = screen.getByLabelText(/Last day of the lease/) as HTMLInputElement
    fireEvent.change(dateInput, { target: { value: '2030-06-30' } })
    await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(2))
    fireEvent.click(await screen.findByRole('radio', { name: /keep/i }))
    await waitFor(() => expect(screen.getByRole('radio', { name: /keep/i })).toBeChecked())

    rerender(<EndLeaseDialog lease={{ ...leaseSummary(), updatedAt: '2026-11-02T00:00:00Z' }} onClose={jest.fn()} onEnded={jest.fn()} />)

    expect((screen.getByLabelText(/Last day of the lease/) as HTMLInputElement).value).toBe('2030-06-30')
    expect(screen.getByRole('radio', { name: /keep/i })).toBeChecked()
    expect(mockApiCall).toHaveBeenCalledTimes(2)
  })

  it('resets the End lease date when the dialog opens for another lease', async () => {
    const { rerender } = renderWithProviders(<EndLeaseDialog lease={leaseSummary()} onClose={jest.fn()} onEnded={jest.fn()} />)
    fireEvent.change(screen.getByLabelText(/Last day of the lease/), { target: { value: '2030-06-30' } })
    rerender(<EndLeaseDialog lease={null} onClose={jest.fn()} onEnded={jest.fn()} />)
    rerender(<EndLeaseDialog lease={leaseSummary()} onClose={jest.fn()} onEnded={jest.fn()} />)
    await waitFor(() => expect((screen.getByLabelText(/Last day of the lease/) as HTMLInputElement).value).not.toBe('2030-06-30'))
  })

  it('keeps the Extend lease inputs when a same-id lease object arrives', () => {
    const { rerender } = renderWithProviders(
      <ExtendLeaseDialog lease={leaseSummary()} defaultExpiryDays={14} onClose={jest.fn()} onExtended={jest.fn()} />,
    )
    fireEvent.change(screen.getByLabelText(/Extend by \(months\)/), { target: { value: '24' } })
    fireEvent.change(screen.getByLabelText(/New monthly rate/), { target: { value: '120' } })

    rerender(<ExtendLeaseDialog lease={{ ...leaseSummary(), updatedAt: '2026-11-02T00:00:00Z' }} defaultExpiryDays={14} onClose={jest.fn()} onExtended={jest.fn()} />)

    expect((screen.getByLabelText(/Extend by \(months\)/) as HTMLInputElement).value).toBe('24')
    expect((screen.getByLabelText(/New monthly rate/) as HTMLInputElement).value).toBe('120')
  })
})
