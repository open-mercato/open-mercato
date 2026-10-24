'use client'

import * as React from 'react'
import type { InjectionSpotId } from '@open-mercato/shared/modules/widgets/injection'
import {
  loadInjectionDataWidgetsForSpot,
  getInjectionRegistryVersion,
  isInjectionRegistryReady,
  subscribeToInjectionRegistryChanges,
  type LoadedInjectionDataWidget,
} from '@open-mercato/shared/modules/widgets/injection-loader'
import { hasAllFeatures } from '@open-mercato/shared/security/features'
import { useBackendChrome } from '../BackendChromeProvider'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('ui').child({ component: 'useInjectionDataWidgets' })
const EMPTY_WIDGETS: LoadedInjectionDataWidget[] = []

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
  const disabled = spotId.startsWith('__disabled__:')
  const registryReady = isInjectionRegistryReady()
  // Re-load when the injection registry is (re-)populated. With the async
  // ClientBootstrap, registration can land after this hook first runs; the
  // version bump triggers a reload so injected menus/columns/fields appear
  // without requiring an unrelated re-render.
  const [registryVersion, setRegistryVersion] = React.useState(() => getInjectionRegistryVersion())

  React.useEffect(() => {
    const unsubscribe = subscribeToInjectionRegistryChanges(() => {
      setRegistryVersion(getInjectionRegistryVersion())
    })
    setRegistryVersion(getInjectionRegistryVersion())
    return unsubscribe
  }, [])

  React.useEffect(() => {
    if (disabled) return
    if (!backendChromeReady || !registryReady) {
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
        logger.error('Failed to load widgets for spot', { spotId, err: loadError })
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
  }, [spotId, registryVersion, backendChromeReady, registryReady, disabled, grantedFeatureList, hasBackendChromePayload])

  return disabled
    ? { widgets: EMPTY_WIDGETS, isLoading: false, error: null }
    : { widgets, isLoading: isLoading || !backendChromeReady || !registryReady, error }
}
