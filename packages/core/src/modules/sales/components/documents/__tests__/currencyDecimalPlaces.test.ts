/**
 * @jest-environment jsdom
 */
import { renderHook } from '@testing-library/react'

const mockApiCall = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}))

import { loadCurrencyDecimalPlaces, useCurrencyDecimalPlacesLoader } from '../currencyDecimalPlaces'

describe('loadCurrencyDecimalPlaces', () => {
  beforeEach(() => {
    mockApiCall.mockReset()
  })

  it('returns the decimal places configured for the currency code', async () => {
    mockApiCall.mockResolvedValue({ ok: true, result: { items: [{ code: 'ETH', decimalPlaces: 18 }] } })

    await expect(loadCurrencyDecimalPlaces(' eth ')).resolves.toBe(18)
    expect(mockApiCall).toHaveBeenCalledWith(
      '/api/currencies/currencies?code=ETH&pageSize=1',
      { headers: { 'x-om-forbidden-redirect': '0' } },
    )
  })

  it('returns null without a request for an empty code', async () => {
    await expect(loadCurrencyDecimalPlaces(null)).resolves.toBeNull()
    await expect(loadCurrencyDecimalPlaces('  ')).resolves.toBeNull()
    expect(mockApiCall).not.toHaveBeenCalled()
  })

  it('returns null when the currency is missing, invalid or cannot be read', async () => {
    mockApiCall.mockResolvedValueOnce({ ok: true, result: { items: [] } })
    await expect(loadCurrencyDecimalPlaces('ETH')).resolves.toBeNull()

    mockApiCall.mockResolvedValueOnce({ ok: true, result: { items: [{ code: 'ETH', decimalPlaces: -1 }] } })
    await expect(loadCurrencyDecimalPlaces('ETH')).resolves.toBeNull()

    mockApiCall.mockResolvedValueOnce({ ok: false, result: null })
    await expect(loadCurrencyDecimalPlaces('ETH')).resolves.toBeNull()

    mockApiCall.mockRejectedValueOnce(new Error('offline'))
    await expect(loadCurrencyDecimalPlaces('ETH')).resolves.toBeNull()
  })
})

describe('useCurrencyDecimalPlacesLoader', () => {
  beforeEach(() => {
    mockApiCall.mockReset()
  })

  it('loads each currency once and reloads only when the code changes', async () => {
    mockApiCall.mockImplementation(async (url: string) => ({
      ok: true,
      result: { items: url.includes('code=ETH') ? [{ code: 'ETH', decimalPlaces: 18 }] : [{ code: 'USD', decimalPlaces: 2 }] },
    }))
    const { result, rerender } = renderHook(() => useCurrencyDecimalPlacesLoader())
    const firstLoader = result.current

    await expect(result.current('ETH')).resolves.toBe(18)
    await expect(result.current(' eth ')).resolves.toBe(18)
    rerender()
    expect(result.current).toBe(firstLoader)
    await expect(result.current('ETH')).resolves.toBe(18)
    expect(mockApiCall).toHaveBeenCalledTimes(1)

    await expect(result.current('USD')).resolves.toBe(2)
    expect(mockApiCall).toHaveBeenCalledTimes(2)
    await expect(result.current(null)).resolves.toBeNull()
    expect(mockApiCall).toHaveBeenCalledTimes(2)
  })
})
