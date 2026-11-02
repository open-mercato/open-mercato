'use client'

import * as React from 'react'
import { mergeLabelCacheEntries } from './wmsLookupLoaders'
import {
  resolveCatalogVariantLabel,
  resolveLocationLabel,
  resolveWarehouseLabel,
} from './inventoryMutationLoaders'

type LabelLine = {
  catalog_variant_id?: string | null
  target_staging_location_id?: string | null
}

export function collectAsnDetailLabelIds(input: {
  warehouseId?: string | null
  lines: LabelLine[]
}): string[] {
  const ids = new Set<string>()
  if (input.warehouseId) ids.add(input.warehouseId)
  for (const line of input.lines) {
    if (line.catalog_variant_id) ids.add(line.catalog_variant_id)
    if (line.target_staging_location_id) ids.add(line.target_staging_location_id)
  }
  return [...ids]
}

async function lookupAsnDetailLabel(id: string): Promise<string | null> {
  const [warehouse, variant, location] = await Promise.all([
    resolveWarehouseLabel(id).catch(() => null),
    resolveCatalogVariantLabel(id).catch(() => null),
    resolveLocationLabel(id).catch(() => null),
  ])
  return warehouse || variant || location || null
}

export function useAsnDetailLabelCache(input: {
  warehouseId?: string | null
  lines: LabelLine[]
}): Record<string, string> {
  const [labelCache, setLabelCache] = React.useState<Record<string, string>>({})
  const resolvedIdsRef = React.useRef(new Set<string>())
  const mountedRef = React.useRef(true)
  const { warehouseId, lines } = input

  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  React.useEffect(() => {
    const missing = collectAsnDetailLabelIds({ warehouseId, lines }).filter(
      (id) => !resolvedIdsRef.current.has(id),
    )
    if (missing.length === 0) return
    for (const id of missing) resolvedIdsRef.current.add(id)
    void Promise.all(
      missing.map(async (id) => {
        const label = await lookupAsnDetailLabel(id)
        return label ? { value: id, label } : null
      }),
    ).then((entries) => {
      if (!mountedRef.current) {
        for (const id of missing) resolvedIdsRef.current.delete(id)
        return
      }
      const found = entries.filter(
        (entry): entry is { value: string; label: string } => entry != null,
      )
      if (found.length === 0) return
      setLabelCache((prev) => mergeLabelCacheEntries(prev, found))
    })
  }, [warehouseId, lines])

  return labelCache
}
