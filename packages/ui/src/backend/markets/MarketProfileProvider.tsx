"use client"

import * as React from 'react'
import type { DisplayProfile } from '@open-mercato/shared/lib/display/profile'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'

/**
 * `null` is a real value here: it means "this organization has not picked a market", and every
 * display helper renders the frozen legacy defaults for it. `undefined` would mean "not resolved",
 * which the provider never exposes because the initial value is server rendered.
 */
const MarketProfileContext = React.createContext<DisplayProfile | null>(null)

type MarketProfileProviderProps = {
  /** Resolved on the server and handed down, exactly like the locale. */
  profile: DisplayProfile | null
  children: React.ReactNode
}

type DisplayProfileResponse = { item: (DisplayProfile & { id: string }) | null }

/**
 * Holds the organization's market display profile for client components.
 *
 * Mounted once in the root layout beside `I18nProvider`, because the profile is read by backend
 * pages, portal pages and the public quote page alike - a route-scoped provider would leave the
 * customer-facing surfaces without one, which is exactly where a US merchant's customers look.
 *
 * The initial value is server rendered, so first paint matches the server and cannot
 * hydrate-mismatch. The one subscription re-reads the profile when an admin changes the market in
 * another tab, so an open tab picks it up over SSE instead of showing yesterday's formats until
 * someone reloads.
 */
export function MarketProfileProvider({ profile, children }: MarketProfileProviderProps) {
  const [current, setCurrent] = React.useState<DisplayProfile | null>(profile)

  // A new server-rendered value (navigation, or a fresh request) wins over stale client state.
  React.useEffect(() => { setCurrent(profile) }, [profile])

  useAppEvent('markets.market_display_profile.*', () => {
    let cancelled = false
    void apiCall<DisplayProfileResponse>('/api/markets/display-profile')
      .then((res) => {
        if (cancelled || !res.ok) return
        // `item: null` means the market was cleared, which is a legitimate new value.
        setCurrent(res.result?.item ?? null)
      })
      .catch(() => {
        // A failed refresh keeps the last known profile rather than dropping the page to defaults.
      })
    return () => { cancelled = true }
  })

  return <MarketProfileContext.Provider value={current}>{children}</MarketProfileContext.Provider>
}

/**
 * The organization's market display profile, or `null` when none was picked.
 *
 * Pass the result straight to any helper in `@open-mercato/shared/lib/display/*`; they all accept
 * `null` and render today's behavior for it.
 */
export function useDisplayProfile(): DisplayProfile | null {
  return React.useContext(MarketProfileContext)
}
