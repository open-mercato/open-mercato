"use client"

import * as React from 'react'
import { useSearchParams } from 'next/navigation'

export type WmsLowStockFilter = 'belowReorder' | 'belowSafety'

export type WmsInventoryScopeParams = {
  warehouseId: string
  catalogVariantId: string
  lotId: string
  lowStock: WmsLowStockFilter | null
}

function parseLowStockFilter(value: string | null): WmsLowStockFilter | null {
  if (value === 'belowReorder' || value === 'belowSafety') return value
  return null
}

export function readWmsInventoryScopeParams(searchParams: URLSearchParams): WmsInventoryScopeParams {
  return {
    warehouseId: searchParams.get('warehouseId')?.trim() ?? '',
    catalogVariantId: searchParams.get('catalogVariantId')?.trim() ?? '',
    lotId: searchParams.get('lotId')?.trim() ?? '',
    lowStock: parseLowStockFilter(searchParams.get('lowStock')),
  }
}

export function useWmsInventoryScopeFromSearchParams(): WmsInventoryScopeParams {
  const searchParams = useSearchParams()
  return React.useMemo(() => readWmsInventoryScopeParams(searchParams), [searchParams])
}
