/** @jest-environment jsdom */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const mockApiCall = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  ...jest.requireActual('@open-mercato/ui/backend/utils/apiCall'),
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}))

import { UnitPickerField } from '../components/leases/leaseCreateFields'

describe('UnitPickerField', () => {
  beforeEach(() => mockApiCall.mockReset())

  it('shows a load error instead of "no unit is free" when the request fails', async () => {
    mockApiCall.mockResolvedValue({ ok: false, status: 500, result: {} })
    renderWithProviders(<UnitPickerField value={null} setValue={jest.fn()} values={{}} />)
    expect(await screen.findByTestId('pm-lease-units-error')).toHaveTextContent('Could not load the units that can be leased.')
  })

  it('shows a permission error for a 403', async () => {
    mockApiCall.mockResolvedValue({ ok: false, status: 403, result: {} })
    renderWithProviders(<UnitPickerField value={null} setValue={jest.fn()} values={{}} />)
    expect(await screen.findByTestId('pm-lease-units-error')).toHaveTextContent('You do not have permission to view the units that can be leased.')
  })

  it('shows a load error when the request throws and keeps the chosen unit', async () => {
    const setValue = jest.fn()
    mockApiCall.mockRejectedValue(new Error('network down'))
    renderWithProviders(<UnitPickerField value="unit-1" setValue={setValue} values={{}} />)
    expect(await screen.findByTestId('pm-lease-units-error')).toBeTruthy()
    expect(setValue).not.toHaveBeenCalled()
  })

  it('shows no error when the units load', async () => {
    mockApiCall.mockResolvedValue({ ok: true, status: 200, result: { items: [] } })
    renderWithProviders(<UnitPickerField value={null} setValue={jest.fn()} values={{}} />)
    await screen.findByRole('combobox')
    expect(screen.queryByTestId('pm-lease-units-error')).toBeNull()
  })
})
