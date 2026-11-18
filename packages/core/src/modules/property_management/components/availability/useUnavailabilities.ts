"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { AvailabilitySubjectType, UnavailabilityRow } from './availabilityModel'

export type UnavailabilityQuery = {
  buildingIds: readonly string[]
  subjectIds?: readonly string[]
  subjectType?: AvailabilitySubjectType
  exactSubjectIds?: readonly string[]
}

export type UnavailabilitiesState = {
  rows: UnavailabilityRow[]
  loading: boolean
  refreshing: boolean
  error: boolean
  truncated?: boolean
  reload: () => void
}

type ListPayload = { items?: UnavailabilityRow[]; truncated?: boolean }

type ExactState = { base: string; token: number; rows: UnavailabilityRow[]; truncated: boolean; error: boolean }

export const EXACT_SUBJECT_BATCH = 100

const LIST_URL = '/api/property_management/unavailabilities'

export function chunkIds(ids: readonly string[], size: number = EXACT_SUBJECT_BATCH): string[][] {
  const unique = Array.from(new Set(ids.filter(Boolean)))
  const chunks: string[][] = []
  for (let index = 0; index < unique.length; index += size) chunks.push(unique.slice(index, index + size))
  return chunks
}

export async function loadExactUnavailabilities(subjectIds: readonly string[]): Promise<{ rows: UnavailabilityRow[]; truncated: boolean; ok: boolean }> {
  const calls = await Promise.all(chunkIds(subjectIds).map((ids) => {
    const params = new URLSearchParams({ active: 'true', subjectIds: ids.join(',') })
    return apiCall<ListPayload>(`${LIST_URL}?${params.toString()}`, undefined, { fallback: {} })
  }))
  if (calls.some((call) => !call.ok)) return { rows: [], truncated: false, ok: false }
  const byId = new Map<string, UnavailabilityRow>()
  for (const call of calls) {
    for (const row of Array.isArray(call.result?.items) ? call.result.items : []) byId.set(row.id, row)
  }
  return { rows: Array.from(byId.values()), truncated: calls.some((call) => call.result?.truncated === true), ok: true }
}

export function useUnavailabilities(query: UnavailabilityQuery | null): UnavailabilitiesState {
  const [rows, setRows] = React.useState<UnavailabilityRow[]>([])
  const [truncated, setTruncated] = React.useState(false)
  const [loadedKey, setLoadedKey] = React.useState('')
  const [error, setError] = React.useState(false)
  const [token, setToken] = React.useState(0)
  const [settledToken, setSettledToken] = React.useState(0)
  const [exact, setExact] = React.useState<ExactState | null>(null)
  const buildingKey = query ? query.buildingIds.join(',') : ''
  const subjectKey = query?.subjectIds ? query.subjectIds.join(',') : ''
  const subjectType = query?.subjectType ?? null
  const exactKey = query?.exactSubjectIds ? query.exactSubjectIds.join(',') : ''
  const requestKey = buildingKey || subjectKey ? `${buildingKey}|${subjectKey}|${subjectType ?? ''}` : ''

  React.useEffect(() => {
    let cancelled = false
    setError(false)
    if (!requestKey) {
      setRows([])
      setTruncated(false)
      setLoadedKey('')
      setSettledToken(token)
      return
    }
    const params = new URLSearchParams({ active: 'true' })
    if (buildingKey) params.set('buildingIds', buildingKey)
    if (subjectKey) params.set('subjectIds', subjectKey)
    if (subjectType) params.set('subjectType', subjectType)
    void apiCall<ListPayload>(`${LIST_URL}?${params.toString()}`, undefined, { fallback: {} })
      .then((call) => {
        if (cancelled) return
        setSettledToken(token)
        if (!call.ok) {
          setLoadedKey('')
          setError(true)
          return
        }
        setRows(Array.isArray(call.result?.items) ? call.result.items : [])
        setTruncated(call.result?.truncated === true)
        setLoadedKey(requestKey)
      })
      .catch((err) => {
        getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.unavailabilities_load_failed' })
        if (cancelled) return
        setSettledToken(token)
        setLoadedKey('')
        setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [buildingKey, subjectKey, subjectType, requestKey, token])

  const primaryLoading = !error && loadedKey !== requestKey
  const primaryRefreshing = !error && !primaryLoading && settledToken !== token
  const needsExact = !error && !primaryLoading && truncated && exactKey.length > 0
  const exactBase = `${requestKey}#${exactKey}`

  React.useEffect(() => {
    if (!needsExact) return
    let cancelled = false
    const settle = (patch: Omit<ExactState, 'base' | 'token'>) => {
      if (!cancelled) setExact({ base: exactBase, token: settledToken, ...patch })
    }
    loadExactUnavailabilities(exactKey.split(','))
      .then((result) => settle({ rows: result.rows, truncated: result.truncated, error: !result.ok }))
      .catch((err) => {
        getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.unavailabilities_load_failed' })
        settle({ rows: [], truncated: false, error: true })
      })
    return () => {
      cancelled = true
    }
  }, [exactBase, exactKey, needsExact, settledToken])

  const reload = React.useCallback(() => setToken((value) => value + 1), [])
  const exactCurrent = needsExact && exact?.base === exactBase ? exact : null
  const exactFresh = Boolean(exactCurrent && exactCurrent.token === settledToken)
  const usableExact = exactCurrent && !exactCurrent.error ? exactCurrent : null
  const outRows = usableExact ? usableExact.rows : rows
  const loading = primaryLoading || (needsExact && exactCurrent === null)
  const exactError = Boolean(exactFresh && exactCurrent?.error)
  const refreshing = !loading && !exactError && (primaryRefreshing || (exactCurrent !== null && !exactFresh))
  const outError = error || exactError
  const outTruncated = needsExact ? Boolean(usableExact?.truncated) : truncated
  return React.useMemo(
    () => ({ rows: outRows, loading, refreshing, error: outError, truncated: outTruncated, reload }),
    [outRows, loading, refreshing, outError, outTruncated, reload],
  )
}
