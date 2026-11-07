"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

type CurrencyListResponse = {
  items?: Array<{ code?: unknown; decimalPlaces?: unknown }>
}

function normalizeCurrencyCode(code: string | null | undefined): string | null {
  const normalized = typeof code === 'string' ? code.trim().toUpperCase() : ''
  return normalized.length ? normalized : null
}

/**
 * Decimal places the tenant configured for `code` in the currencies module, or
 * `null` when the module is absent, the caller cannot read currencies, or the
 * code is not configured.
 */
export async function loadCurrencyDecimalPlaces(code: string | null | undefined): Promise<number | null> {
  const normalized = normalizeCurrencyCode(code)
  if (!normalized) return null
  try {
    const call = await apiCall<CurrencyListResponse>(
      `/api/currencies/currencies?code=${encodeURIComponent(normalized)}&pageSize=1`,
      { headers: { 'x-om-forbidden-redirect': '0' } },
    )
    if (!call.ok) return null
    const items = call.result?.items
    const decimalPlaces = (Array.isArray(items) ? items : []).find((item) => item.code === normalized)?.decimalPlaces
    return typeof decimalPlaces === 'number' && Number.isInteger(decimalPlaces) && decimalPlaces >= 0
      ? decimalPlaces
      : null
  } catch {
    return null
  }
}

/** Loads the configured decimal places once per currency code change. */
export function useCurrencyDecimalPlaces(code: string | null | undefined): number | null {
  const normalized = normalizeCurrencyCode(code)
  const [loaded, setLoaded] = React.useState<{ code: string; decimalPlaces: number | null } | null>(null)

  React.useEffect(() => {
    if (!normalized) return
    let cancelled = false
    void loadCurrencyDecimalPlaces(normalized).then((decimalPlaces) => {
      if (!cancelled) setLoaded({ code: normalized, decimalPlaces })
    })
    return () => {
      cancelled = true
    }
  }, [normalized])

  return loaded && loaded.code === normalized ? loaded.decimalPlaces : null
}

/**
 * A loader that fetches the configured decimal places once per currency code for
 * the lifetime of the calling component and reuses the result on later calls.
 */
export function useCurrencyDecimalPlacesLoader(): (code: string | null | undefined) => Promise<number | null> {
  const cacheRef = React.useRef<{ code: string; decimalPlaces: Promise<number | null> } | null>(null)
  return React.useCallback((code: string | null | undefined) => {
    const normalized = normalizeCurrencyCode(code)
    if (!normalized) return Promise.resolve(null)
    if (!cacheRef.current || cacheRef.current.code !== normalized) {
      cacheRef.current = { code: normalized, decimalPlaces: loadCurrencyDecimalPlaces(normalized) }
    }
    return cacheRef.current.decimalPlaces
  }, [])
}
