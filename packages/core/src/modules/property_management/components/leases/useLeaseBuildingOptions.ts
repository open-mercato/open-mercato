"use client"

import * as React from 'react'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { fetchBuildingOptions } from '../buildingOptions'

export type LeaseBuildingOption = { value: string; label: string }

export type LeaseBuildingOptionsState = { buildings: LeaseBuildingOption[] | null; loadError: string | null; retry: () => void }

export function useLeaseBuildingOptions(): LeaseBuildingOptionsState {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [buildings, setBuildings] = React.useState<LeaseBuildingOption[] | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [attempt, setAttempt] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    const failed = () => {
      if (!cancelled) setLoadError(t('property_management.buildings.list.loadError', 'Could not load buildings.'))
    }
    setLoadError(null)
    fetchBuildingOptions<{ id: string; name: string }>()
      .then((result) => {
        if (cancelled) return
        if (!result.ok) {
          failed()
          return
        }
        setBuildings(result.items.map((item) => ({ value: item.id, label: item.name })))
      })
      .catch(failed)
    return () => {
      cancelled = true
    }
  }, [attempt, scopeVersion, t])

  const retry = React.useCallback(() => setAttempt((value) => value + 1), [])
  return { buildings, loadError, retry }
}
