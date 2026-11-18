"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { fetchBuildingOptions } from '../buildingOptions'
import { applyCrmAccess } from './floorPlanCrm'
import type { BuildingOption, FloorOption, FloorPlanLayout } from './floorPlanModel'

type LoadState<T> = { data: T | null; loading: boolean; error: boolean; notFound: boolean; reload: () => void }

type BuildingPayload = { items?: Array<{ id?: unknown; name?: unknown; status?: unknown; floors?: unknown }>; canManageAll?: unknown }

export type FloorPlanBuildings = { buildings: BuildingOption[]; canManageAll: boolean }

const BUILDINGS_URL = '/api/property_management/buildings'

function readFloors(value: unknown): FloorOption[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      const record = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {}
      return {
        id: typeof record.id === 'string' ? record.id : '',
        number: typeof record.number === 'number' ? record.number : 0,
        name: typeof record.name === 'string' ? record.name : '',
        sizeX: Number(record.sizeX) || 0,
        sizeY: Number(record.sizeY) || 0,
      }
    })
    .filter((floor) => floor.id.length > 0)
    .sort((left, right) => left.number - right.number)
}

function readBuildings(items: BuildingPayload['items']): BuildingOption[] {
  return (Array.isArray(items) ? items : [])
    .filter((item) => typeof item.id === 'string')
    .map((item) => ({
      id: item.id as string,
      name: typeof item.name === 'string' ? item.name : '',
      status: typeof item.status === 'string' ? item.status : 'active',
      floors: readFloors(item.floors),
    }))
}

export function useFloorPlanBuildings(requestedId: string | null = null): LoadState<FloorPlanBuildings> & { resolving: boolean } {
  const scopeVersion = useOrganizationScopeVersion()
  const [data, setData] = React.useState<FloorPlanBuildings | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState(false)
  const [token, setToken] = React.useState(0)
  const [checkedId, setCheckedId] = React.useState<string | null>(null)
  const missingId = data && requestedId && !data.buildings.some((building) => building.id === requestedId) ? requestedId : null

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    fetchBuildingOptions<NonNullable<BuildingPayload['items']>[number]>({ status: 'all' })
      .then((result) => {
        if (cancelled) return
        if (!result.ok) {
          setError(true)
          return
        }
        setCheckedId(null)
        setData({ canManageAll: result.canManageAll, buildings: readBuildings(result.items) })
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [scopeVersion, token])

  React.useEffect(() => {
    if (!data || !missingId) return
    let cancelled = false
    const params = new URLSearchParams({ id: missingId, status: 'all', pageSize: '1' })
    apiCall<BuildingPayload>(`${BUILDINGS_URL}?${params.toString()}`, undefined, { fallback: {} })
      .then((call) => {
        if (cancelled || !call.ok) return
        const extra = readBuildings(call.result?.items).find((building) => building.id === missingId)
        if (!extra) return
        setData((current) => (current && !current.buildings.some((building) => building.id === extra.id)
          ? { ...current, buildings: [...current.buildings, extra] }
          : current))
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setCheckedId(missingId)
      })
    return () => {
      cancelled = true
    }
  }, [data, missingId])

  const reload = React.useCallback(() => setToken((value) => value + 1), [])
  return { data, loading, error, notFound: false, reload, resolving: missingId !== null && checkedId !== missingId }
}

export function useFloorPlanLayout(floorId: string | null, date: string): LoadState<FloorPlanLayout> {
  const [data, setData] = React.useState<FloorPlanLayout | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState(false)
  const [notFound, setNotFound] = React.useState(false)
  const [token, setToken] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    if (!floorId) {
      setData(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(false)
    setNotFound(false)
    const url = `/api/property_management/floors/${encodeURIComponent(floorId)}/layout?date=${encodeURIComponent(date)}`
    apiCall<FloorPlanLayout>(url)
      .then((call) => {
        if (cancelled) return
        if (call.status === 404) {
          setNotFound(true)
          setData(null)
        } else if (!call.ok || !call.result) {
          setError(true)
          setData(null)
        } else {
          setData(applyCrmAccess(call.result))
        }
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [floorId, date, token])

  const reload = React.useCallback(() => setToken((value) => value + 1), [])
  return { data, loading, error, notFound, reload }
}
