'use client'

import * as React from 'react'
import type { InjectionSpotId } from '@open-mercato/shared/modules/widgets/injection'
import {
  loadInjectionDataWidgetsForSpot,
  getInjectionRegistryVersion,
  subscribeToInjectionRegistryChanges,
  type LoadedInjectionDataWidget,
} from '@open-mercato/shared/modules/widgets/injection-loader'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('ui').child({ component: 'useInjectionDataWidgets' })

export function useInjectionDataWidgets(spotId: InjectionSpotId): {
  widgets: LoadedInjectionDataWidget[]
  isLoading: boolean
  error: string | null
} {
  const [widgets, setWidgets] = React.useState<LoadedInjectionDataWidget[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
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
  }, [spotId, registryVersion])

  return { widgets, isLoading, error }
}
