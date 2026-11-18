/** @jest-environment jsdom */
import * as React from 'react'
import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { UnitProductHistory, unitProductLockedReason, useUnitProductInfo } from '../components/placement/UnitProductHistory'
import { PlacementPageState } from '../components/placement/PlacementFormShell'

type CallResult = { ok: boolean; status: number; result: unknown }
const mockApiCall = jest.fn<Promise<CallResult>, [string, RequestInit?, unknown?]>()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (url: string, init?: RequestInit, options?: unknown) => mockApiCall(url, init, options),
}))

const translate: TranslateFn = ((key: string) => key) as TranslateFn

const INFO = { periods: [], productLocked: false, activeLeases: [], upcomingBookings: [] }

describe('unitProductLockedReason', () => {
  it('locks a leased unit', () => {
    expect(unitProductLockedReason(translate, 'unit-1', { info: { ...INFO, productLocked: true }, loading: false, failed: false }))
      .toBe('property_management.units.form.productLocked')
  })

  it('leaves a unit that is known not to be leased editable', () => {
    expect(unitProductLockedReason(translate, 'unit-1', { info: INFO, loading: false, failed: false })).toBeNull()
  })

  it('treats an unknown lease state as locked', () => {
    expect(unitProductLockedReason(translate, 'unit-1', { info: null, loading: true, failed: false })).toBe('property_management.units.form.productLockChecking')
    expect(unitProductLockedReason(translate, 'unit-1', { info: null, loading: false, failed: true })).toBe('property_management.units.form.productLockUnknown')
  })

  it('never locks a unit that is being created', () => {
    expect(unitProductLockedReason(translate, null, { info: null, loading: false, failed: false })).toBeNull()
  })
})

describe('useUnitProductInfo', () => {
  beforeEach(() => mockApiCall.mockReset())

  it('reports a failed load and recovers on retry', async () => {
    mockApiCall
      .mockResolvedValueOnce({ ok: false, status: 500, result: { error: 'boom' } })
      .mockResolvedValueOnce({ ok: true, status: 200, result: { ...INFO, productLocked: true } })
    const { result } = renderHook(() => useUnitProductInfo('unit-1'))
    await waitFor(() => expect(result.current.failed).toBe(true))
    expect(result.current.info).toBeNull()
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.info?.productLocked).toBe(true))
    expect(result.current.failed).toBe(false)
  })

  it('reports a thrown request as failed', async () => {
    mockApiCall.mockRejectedValueOnce(new Error('network down'))
    const { result } = renderHook(() => useUnitProductInfo('unit-1'))
    await waitFor(() => expect(result.current.failed).toBe(true))
    expect(result.current.loading).toBe(false)
  })
})

describe('UnitProductHistory', () => {
  it('shows an error with a retry instead of an empty history', () => {
    const onRetry = jest.fn()
    renderWithProviders(<UnitProductHistory periods={[]} failed onRetry={onRetry} />)
    expect(screen.getByTestId('unit-product-history-error')).toBeTruthy()
    expect(screen.queryByText('No product history yet.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})

describe('PlacementPageState', () => {
  it('offers a retry when the record cannot be loaded', () => {
    const onRetry = jest.fn()
    renderWithProviders(<PlacementPageState loading={false} notFound={false} error backHref="/back" onRetry={onRetry} />)
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
