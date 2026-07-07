'use client'

import * as React from 'react'
import type { InjectionSpotId } from '@open-mercato/shared/modules/widgets/injection'
import {
  loadInjectionDataWidgetsForSpot,
  getInjectionRegistryVersion,
  subscribeToInjectionRegistryChanges,
  type LoadedInjectionDataWidget,
} from '@open-mercato/shared/modules/widgets/injection-loader'
import { hasAllFeatures } from '@open-mercato/shared/security/features'
import { useBackendChrome } from '../BackendChromeProvider'

export function useInjectionDataWidgets(spotId: InjectionSpotId): {
  widgets: LoadedInjectionDataWidget[]
  isLoading: boolean
  error: string | null
} {
  const [widgets, setWidgets] = React.useState<LoadedInjectionDataWidget[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const { payload, isReady: backendChromeReady } = useBackendChrome()
  const grantedFeatureList = React.useMemo(
    () => payload?.grantedFeatures ?? [],
    [payload?.grantedFeatures],
  )
  const hasBackendChromePayload = payload !== null
  // Re-load when the injection registry is (re-)populated. With the async
  // ClientBootstrap, registration can land after this hook first runs; the
  // version bump triggers a reload so injected menus/columns/fields appear
  // without requiring an unrelated re-render.
  const [registryVersion, setRegistryVersion] = React.useState(() => getInjectionRegistryVersion())

  React.useEffect(() => {
    return subscribeToInjectionRegistryChanges(() => {
      setRegistryVersion(getInjectionRegistryVersion())
    })
  }, [])

  React.useEffect(() => {
    if (!backendChromeReady) {
      setIsLoading(true)
      setError(null)
      return
    }
    let mounted = true
    const load = async () => {
      try {
        setIsLoading(true)
        setError(null)
        const loaded = await loadInjectionDataWidgetsForSpot(spotId)
        if (!mounted) return
        setWidgets(
          loaded.filter((widget) => {
            if (!hasBackendChromePayload) return true
            const features = widget.metadata.features ?? []
            return features.length === 0 || hasAllFeatures(grantedFeatureList, features)
          })
        )
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
  }, [spotId, registryVersion, backendChromeReady, grantedFeatureList, hasBackendChromePayload])

  return { widgets, isLoading, error }
}
