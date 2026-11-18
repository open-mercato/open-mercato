/** @jest-environment jsdom */
import * as React from 'react'
import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { registerTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { UnitProductField, useCatalogCategories } from '../components/placement/UnitProductField'

type CallResult = { ok: boolean; status: number; result: unknown }
const mockApiCall = jest.fn<Promise<CallResult>, [string, RequestInit?, unknown?]>()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (url: string, init?: RequestInit, options?: unknown) => mockApiCall(url, init, options),
}))

const CATEGORY = { id: 'category-1', name: 'Desks', depth: 0, parentId: null }
const PRODUCT = { id: 'product-1', title: 'Hot desk', use: 'bookable', billingUnit: 'hour' }

beforeEach(() => mockApiCall.mockReset())

describe('useCatalogCategories', () => {
  it('reports a refused load and recovers on retry', async () => {
    mockApiCall
      .mockResolvedValueOnce({ ok: false, status: 403, result: { error: 'forbidden' } })
      .mockResolvedValueOnce({ ok: true, status: 200, result: { categories: [CATEGORY], products: [] } })
    const { result } = renderHook(() => useCatalogCategories(null))
    await waitFor(() => expect(result.current.failedStatus).toBe(403))
    expect(result.current.categories).toEqual([])
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.categories).toEqual([CATEGORY]))
    expect(result.current.failedStatus).toBeNull()
  })

  it('reports a thrown request to telemetry and as failed', async () => {
    const reportError = jest.fn()
    const unregister = registerTelemetryRuntime({ reportError } as never)
    try {
      mockApiCall.mockRejectedValueOnce(new Error('[internal] network down'))
      const { result } = renderHook(() => useCatalogCategories(null))
      await waitFor(() => expect(result.current.failedStatus).toBe(0))
      expect(result.current.loading).toBe(false)
      expect(reportError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ code: 'property_management.catalog_categories_load_failed' }))
    } finally {
      unregister()
    }
  })
})

describe('UnitProductField', () => {
  function renderField(setValue: jest.Mock) {
    return renderWithProviders(
      <UnitProductField
        id="catalogProductId"
        value={PRODUCT.id}
        setValue={setValue}
        values={{ catalogCategoryId: CATEGORY.id, catalogProductId: PRODUCT.id }}
        categoryName={CATEGORY.name}
        lockedReason={null}
      />,
    )
  }

  it('shows a failed product load with a retry and keeps the chosen product', async () => {
    mockApiCall
      .mockResolvedValueOnce({ ok: false, status: 500, result: { error: 'boom' } })
      .mockResolvedValueOnce({ ok: true, status: 200, result: { categories: [], products: [PRODUCT] } })
    const setValue = jest.fn()
    renderField(setValue)
    const alert = await screen.findByTestId('pm-unit-products-error')
    expect(alert.textContent).toContain('Could not load the catalog products.')
    expect(setValue).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('pm-unit-products-retry'))
    await waitFor(() => expect(screen.queryByTestId('pm-unit-products-error')).toBeNull())
    expect(mockApiCall).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(screen.getByTestId('unit-use').textContent).toContain('Bookable'))
    expect(setValue).not.toHaveBeenCalled()
  })

  it('names a missing permission instead of listing no products', async () => {
    mockApiCall.mockResolvedValueOnce({ ok: false, status: 403, result: { error: 'forbidden' } })
    renderField(jest.fn())
    const alert = await screen.findByTestId('pm-unit-products-error')
    expect(alert.textContent).toContain('You do not have permission to view the catalog products.')
  })
})
