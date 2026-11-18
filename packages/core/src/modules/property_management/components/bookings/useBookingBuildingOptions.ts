"use client"

import * as React from 'react'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { fetchBuildingOptions } from '../buildingOptions'

export type BookingBuildingOption = { id: string; name: string; status?: string }

export type BookingBuildingOptions = { buildings: BookingBuildingOption[]; failed: boolean; retry: () => void }

export function useBookingBuildingOptions(scopeVersion: number): BookingBuildingOptions {
  const t = useT()
  const [buildings, setBuildings] = React.useState<BookingBuildingOption[]>([])
  const [failed, setFailed] = React.useState(false)
  const [attempt, setAttempt] = React.useState(0)
  const failureFlashed = React.useRef(false)

  React.useEffect(() => {
    let cancelled = false
    const fail = () => {
      if (cancelled) return
      setBuildings([])
      setFailed(true)
      if (failureFlashed.current) return
      failureFlashed.current = true
      flash(t('property_management.buildings.list.loadError', 'Could not load buildings.'), 'error')
    }
    void fetchBuildingOptions<BookingBuildingOption>({ status: 'all' })
      .then((result) => {
        if (cancelled) return
        if (!result.ok) {
          fail()
          return
        }
        failureFlashed.current = false
        setFailed(false)
        setBuildings(result.items)
      })
      .catch(fail)
    return () => {
      cancelled = true
    }
  }, [scopeVersion, attempt, t])

  const retry = React.useCallback(() => setAttempt((value) => value + 1), [])
  return React.useMemo(() => ({ buildings, failed, retry }), [buildings, failed, retry])
}
