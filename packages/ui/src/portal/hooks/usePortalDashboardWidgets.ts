'use client'

import * as React from 'react'
import type { InjectionSpotId } from '@open-mercato/shared/modules/widgets/injection'
import { loadInjectionWidgetsForSpot, type LoadedInjectionWidget } from '@open-mercato/shared/modules/widgets/injection-loader'

/**
 * Loads UI injection widgets (with Widget component) for a portal spot.
 *
 * Unlike `useInjectionDataWidgets` which loads data-only widgets (columns, fields, menuItems),
 * this hook loads widgets that export a `Widget` React component — suitable for
 * portal dashboard sections and other UI injection spots.
 */
export function usePortalDashboardWidgets(spotId: InjectionSpotId): {
  widgets: LoadedInjectionWidget[]
  isLoading: boolean
  error: string | null
} {
  const [widgets, setWidgets] = React.useState<LoadedInjectionWidget[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        setIsLoading(true)
        setError(null)
        const loaded = await loadInjectionWidgetsForSpot(spotId)
        if (!mounted) return
        // Only keep widgets that have a Widget component
        const uiWidgets = loaded.filter((w) => typeof w.Widget === 'function')
        setWidgets(uiWidgets)
      } catch (loadError) {
        if (!mounted) return
        console.error(`[usePortalDashboardWidgets] Failed to load widgets for spot ${spotId}:`, loadError)
        setError(loadError instanceof Error ? loadError.message : String(loadError))
        setWidgets([])
      } finally {
        if (mounted) setIsLoading(false)
      }
    }
    void load()
    return () => {
      mounted = false
    }
  }, [spotId])

  return { widgets, isLoading, error }
}
