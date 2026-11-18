/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { ExtendLeaseDialog } from '../components/leases/ExtendLeaseDialog'
import type { LeaseSummary } from '../components/leases/leaseModel'

const mockSend = jest.fn()

jest.mock('../components/leases/useLeaseMutation', () => ({ useLeaseMutation: () => ({ send: mockSend }) }))

function leaseSummary(): LeaseSummary {
  return {
    id: '44444444-4444-4444-8444-444444444444', reference: 'L-0002', status: 'active', buildingId: 'b', buildingName: 'HQ', unitId: 'u', unitName: 'U1', floorName: null,
    customerCompanyId: 'c', companyName: 'Acme', primaryContactPersonId: null, contactName: null, startsOn: '2020-01-01', termMonths: 120,
    endsOn: '2099-12-31', daysLeft: 9000, productName: 'Office', monthlyRate: '100', currencyCode: 'EUR', salesOrderId: 'order-1',
    salesOrderNumber: 'SO-1', openProposal: null, pendingChange: null, billingPending: false, billingAttention: false,
    unitUnavailable: false, unitUnavailableFrom: null, unitUnavailableUntil: null, updatedAt: '2026-11-01T00:00:00Z',
  } as LeaseSummary
}

function httpError(message: string, extras: Record<string, unknown>): Error {
  return Object.assign(new Error(message), extras)
}

function renderDialog() {
  renderWithProviders(<ExtendLeaseDialog lease={leaseSummary()} defaultExpiryDays={14} onClose={jest.fn()} onExtended={jest.fn()} />)
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.change(screen.getByLabelText(/New monthly rate/), { target: { value: '120.12345' } })
}

function confirmButton(): HTMLElement {
  const buttons = screen.getAllByRole('button')
  return buttons[buttons.length - 1]
}

describe('ExtendLeaseDialog server field errors', () => {
  beforeEach(() => mockSend.mockReset())

  it('shows a too-precise rate under the monthly rate input', async () => {
    mockSend.mockRejectedValueOnce(httpError('Invalid input', { status: 400, fieldErrors: { monthlyRate: 'Enter a monthly rate with at most 4 decimal places.' } }))
    renderDialog()
    fireEvent.click(confirmButton())
    expect(await screen.findByTestId('pm-extend-rate-error')).toHaveTextContent('Enter a monthly rate with at most 4 decimal places.')
    expect(screen.getByLabelText(/New monthly rate/)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByText('Invalid input')).toBeNull()
  })

  it('falls back to the form-level message when the error names no dialog field', async () => {
    mockSend.mockRejectedValueOnce(httpError('Something went wrong.', { status: 500 }))
    renderDialog()
    fireEvent.click(confirmButton())
    await waitFor(() => expect(screen.getByText('Something went wrong.')).toBeInTheDocument())
    expect(screen.queryByTestId('pm-extend-rate-error')).toBeNull()
  })
})
