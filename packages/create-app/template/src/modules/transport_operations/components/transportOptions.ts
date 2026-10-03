"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

/**
 * The three lookups every transport screen needs, in one place.
 *
 * The query engine cannot join across the module's own tables either — a trip list projects
 * `route_id`, `vehicle_id` and `driver_id`, so the labels have to come from the sibling endpoints.
 * Keeping the hooks here rather than in whichever screen first needed them also keeps the dependency
 * graph readable: the trips screen should not import from the vehicles screen.
 */

export type TransportRouteOption = {
  id: string
  code: string
  name: string
  start_location?: string | null
  end_location?: string | null
}

export type TransportVehicleOption = {
  id: string
  plate_number: string
  make: string
  model: string
  status?: string | null
}

export type TransportDriverOption = {
  id: string
  full_name: string
  license_number: string
  license_expiry?: string | null
}

export function routeLabel(route: Pick<TransportRouteOption, 'code' | 'name'>): string {
  return `${route.code} · ${route.name}`.trim()
}

export function vehicleLabel(vehicle: Pick<TransportVehicleOption, 'plate_number' | 'make' | 'model'>): string {
  return `${vehicle.plate_number} · ${vehicle.make} ${vehicle.model}`.trim()
}

export function driverLabel(driver: Pick<TransportDriverOption, 'full_name' | 'license_number'>): string {
  return `${driver.full_name} (${driver.license_number})`.trim()
}

function useLabelMap<TItem extends { id: string }>(items: TItem[], labelOf: (item: TItem) => string) {
  return React.useMemo(() => {
    const map = new Map<string, string>()
    for (const item of items) map.set(item.id, labelOf(item))
    return map
  }, [items, labelOf])
}

/** Routes once per scope: the label of a trip's route and the options of a picker or filter. */
export function useRouteOptions() {
  const scopeVersion = useOrganizationScopeVersion()
  const query = useQuery({
    queryKey: ['transport-route-options', scopeVersion],
    queryFn: () => fetchCrudList<TransportRouteOption>('transport_operations/routes', {
      pageSize: 100,
      sortField: 'code',
      sortDir: 'asc',
    }),
    staleTime: 5 * 60 * 1000,
  })
  const routes = query.data?.items ?? []
  const labels = useLabelMap(routes, routeLabel)
  return { routes, labels }
}

/** Vehicles once per scope, for the same two purposes. */
export function useVehicleOptions() {
  const scopeVersion = useOrganizationScopeVersion()
  const query = useQuery({
    queryKey: ['transport-vehicle-options', scopeVersion],
    queryFn: () => fetchCrudList<TransportVehicleOption>('transport_operations/vehicles', {
      pageSize: 100,
      sortField: 'plateNumber',
      sortDir: 'asc',
    }),
    staleTime: 5 * 60 * 1000,
  })
  const vehicles = query.data?.items ?? []
  const labels = useLabelMap(vehicles, vehicleLabel)
  return { vehicles, labels }
}

/** Drivers once per scope, for the same two purposes. */
export function useDriverOptions() {
  const scopeVersion = useOrganizationScopeVersion()
  const query = useQuery({
    queryKey: ['transport-driver-options', scopeVersion],
    queryFn: () => fetchCrudList<TransportDriverOption>('transport_operations/drivers', {
      pageSize: 100,
      sortField: 'fullName',
      sortDir: 'asc',
    }),
    staleTime: 5 * 60 * 1000,
  })
  const drivers = query.data?.items ?? []
  const labels = useLabelMap(drivers, driverLabel)
  return { drivers, labels }
}
