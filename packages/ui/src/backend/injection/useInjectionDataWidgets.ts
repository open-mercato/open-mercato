'use client'

import * as React from 'react'
import type { InjectionSpotId } from '@open-mercato/shared/modules/widgets/injection'
import { loadInjectionDataWidgetsForSpot, type LoadedInjectionDataWidget } from '@open-mercato/shared/modules/widgets/injection-loader'

export function useInjectionDataWidgets(spotId: InjectionSpotId): {
  widgets: LoadedInjectionDataWidget[]
  isLoading: boolean
  error: string | null
} {
  const [widgets, setWidgets] = React.useState<LoadedInjectionDataWidget[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        setIsLoading(true)
        setError(null)
        const loaded = await loadInjectionDataWidgetsForSpot(spotId)
        if (!mounted) return
        setWidgets(loaded)
      } catch (loadError) {
        if (!mounted) return
        console.error(`[useInjectionDataWidgets] Failed to load widgets for spot ${spotId}:`, loadError)
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
