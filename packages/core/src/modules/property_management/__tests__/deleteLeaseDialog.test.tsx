/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { DeleteLeaseDialog } from '../components/leases/DeleteLeaseDialog'
import type { LeaseSummary } from '../components/leases/leaseModel'

const mockSend = jest.fn()

jest.mock('../components/leases/useLeaseMutation', () => ({ useLeaseMutation: () => ({ send: mockSend }) }))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: () => false }))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

function leaseSummary(status: LeaseSummary['status']): LeaseSummary {
  return {
    id: '44444444-4444-4444-8444-444444444444', reference: 'L-0003', status, buildingId: 'b', buildingName: 'HQ', unitId: 'u', unitName: 'U1',
    floorName: null, customerCompanyId: 'c', companyName: 'Acme', primaryContactPersonId: null, contactName: null, startsOn: '2020-01-01',
    termMonths: 12, endsOn: '2020-12-31', daysLeft: 0, productName: 'Office', monthlyRate: '100', currencyCode: 'EUR', salesOrderId: 'order-1',
    salesOrderNumber: 'SO-1', openProposal: null, pendingChange: null, billingPending: false, billingAttention: false,
    unitUnavailable: false, unitUnavailableFrom: null, unitUnavailableUntil: null, updatedAt: '2026-11-01T00:00:00Z',
  } as LeaseSummary
}

async function refuseAndPressShortcut(status: LeaseSummary['status'], onEndInstead: jest.Mock) {
  mockSend.mockRejectedValueOnce(Object.assign(new Error('invoiced'), { code: 'lease_invoiced' }))
  renderWithProviders(<DeleteLeaseDialog lease={leaseSummary(status)} onClose={jest.fn()} onDeleted={jest.fn()} onEndInstead={onEndInstead} />)
  fireEvent.click(screen.getByRole('button', { name: /delete lease/i }))
  const refusal = await screen.findByTestId('pm-lease-delete-refused')
  fireEvent.keyDown(refusal, { key: 'Enter', metaKey: true })
}

describe('DeleteLeaseDialog', () => {
  beforeEach(() => mockSend.mockReset())

  it('offers End lease instead on the shortcut for an active lease that was invoiced', async () => {
    const onEndInstead = jest.fn()
    await refuseAndPressShortcut('active', onEndInstead)
    expect(onEndInstead).toHaveBeenCalledTimes(1)
  })

  it('does not jump to End lease on the shortcut when the lease cannot be ended', async () => {
    const onEndInstead = jest.fn()
    await refuseAndPressShortcut('ended', onEndInstead)
    expect(screen.queryByRole('button', { name: /end lease instead/i })).toBeNull()
    expect(onEndInstead).not.toHaveBeenCalled()
    expect(mockSend).toHaveBeenCalledTimes(1)
  })
})
