"use client"

import * as React from 'react'
import { AvailabilitySwitch } from './AvailabilitySwitch'
import type { UnavailabilitiesState } from './useUnavailabilities'
import type { AvailabilityAncestor, AvailabilitySubject } from './availabilityModel'

const AvailabilityStateContext = React.createContext<UnavailabilitiesState | null>(null)

export type AvailabilityStateProviderProps = { value: UnavailabilitiesState; children: React.ReactNode }

export function AvailabilityStateProvider({ value, children }: AvailabilityStateProviderProps) {
  return <AvailabilityStateContext.Provider value={value}>{children}</AvailabilityStateContext.Provider>
}

export type AvailabilityCellProps = {
  subject: AvailabilitySubject
  ancestors?: readonly AvailabilityAncestor[]
  disabled?: boolean
}

export function AvailabilityCell({ subject, ancestors, disabled }: AvailabilityCellProps) {
  const availability = React.useContext(AvailabilityStateContext)
  if (!availability) return null
  return (
    <AvailabilitySwitch
      subject={subject}
      rows={availability.rows}
      ancestors={ancestors}
      disabled={disabled}
      loading={availability.loading}
      refreshing={availability.refreshing}
      error={availability.error}
      truncated={availability.truncated}
      onRetry={availability.reload}
      onChanged={availability.reload}
    />
  )
}
