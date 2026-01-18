"use client"

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import {
  useCustomFieldDefs,
  normalizeEntityIds,
  type CustomFieldDefDto,
} from '@open-mercato/ui/backend/utils/customFieldDefs'
import type { DictionaryMap } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import { ensureDictionaryEntries } from '@open-mercato/core/modules/dictionaries/components/hooks/useDictionaryEntries'
import { normalizeCustomFieldKey } from '../customFieldUtils'

export type CustomFieldDisplayResources = {
  definitions: CustomFieldDefDto[]
  dictionaryMapsByKey: Record<string, DictionaryMap>
  isLoading: boolean
  error: unknown
}

function sanitizeDictionaryId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

export function useCustomFieldDisplay(entityIds: string | string[] | null | undefined): CustomFieldDisplayResources {
  const normalizedIds = React.useMemo(() => normalizeEntityIds(entityIds ?? []), [entityIds])
  const defsQuery = useCustomFieldDefs(normalizedIds, { enabled: normalizedIds.length > 0 })
  const scopeVersion = useOrganizationScopeVersion()
  const queryClient = useQueryClient()

  const [dictionaryMapsById, setDictionaryMapsById] = React.useState<Record<string, DictionaryMap>>({})
  const [dictionaryLoading, setDictionaryLoading] = React.useState(false)

  React.useEffect(() => {
    const defs = defsQuery.data ?? []
    const dictionaryIds = defs
      .map((def) => sanitizeDictionaryId(def.dictionaryId))
      .filter((value): value is string => !!value)
    if (!dictionaryIds.length) {
      setDictionaryMapsById((prev) => (Object.keys(prev).length ? {} : prev))
      setDictionaryLoading(false)
      return
    }

    let cancelled = false
    setDictionaryLoading(true)
    const load = async () => {
      const unique = Array.from(new Set(dictionaryIds))
      const nextMaps: Record<string, DictionaryMap> = {}
      await Promise.all(
        unique.map(async (dictionaryId) => {
          try {
            const data = await ensureDictionaryEntries(queryClient, dictionaryId, scopeVersion)
            nextMaps[dictionaryId] = data.map
          } catch {
            nextMaps[dictionaryId] = {}
          }
        }),
      )
      if (!cancelled) {
        setDictionaryMapsById((prev) => {
          const prevKeys = Object.keys(prev)
          const nextKeys = Object.keys(nextMaps)
          if (
            prevKeys.length === nextKeys.length &&
            prevKeys.every((key) => prev[key] === nextMaps[key])
          ) {
            return prev
          }
          return nextMaps
        })
        setDictionaryLoading(false)
      }
    }

    load().catch(() => {
      if (!cancelled) {
        setDictionaryMapsById({})
        setDictionaryLoading(false)
      }
    })

    return () => {
      cancelled = true
    }
  }, [defsQuery.data, queryClient, scopeVersion])

  const dictionaryMapsByKey = React.useMemo(() => {
    const defs = defsQuery.data ?? []
    if (!defs.length) return {}
    const map: Record<string, DictionaryMap> = {}
    defs.forEach((def) => {
      const dictionaryId = sanitizeDictionaryId(def.dictionaryId)
      if (!dictionaryId) return
      const key = typeof def.key === 'string' ? def.key : ''
      const normalizedKey = normalizeCustomFieldKey(key)
      if (!normalizedKey) return
      const dictionaryMap = dictionaryMapsById[dictionaryId] ?? {}
      map[key] = dictionaryMap
      map[normalizedKey] = dictionaryMap
    })
    return map
  }, [defsQuery.data, dictionaryMapsById])

  return {
    definitions: defsQuery.data ?? [],
    dictionaryMapsByKey,
    isLoading: defsQuery.isLoading || dictionaryLoading,
    error: defsQuery.error,
  }
}
