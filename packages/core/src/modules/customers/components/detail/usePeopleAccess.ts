"use client"

import * as React from 'react'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { hasFeature } from '@open-mercato/shared/security/features'

export type PeopleAccess = {
  canViewPeople: boolean
  isReady: boolean
}

export function usePeopleAccess(): PeopleAccess {
  const { payload, isReady } = useBackendChrome()
  const canViewPeople = React.useMemo(
    () => hasFeature(payload?.grantedFeatures ?? [], 'customers.people.view'),
    [payload?.grantedFeatures],
  )
  return { canViewPeople, isReady }
}
