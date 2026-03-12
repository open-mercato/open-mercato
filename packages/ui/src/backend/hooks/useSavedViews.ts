'use client'

import * as React from 'react'
import { apiCall } from '../utils/apiCall'
import type { PerspectiveSettings } from '@open-mercato/shared/modules/perspectives/types'

/**
 * Represents a saved view as consumed by list pages.
 * Maps perspective settings to the common saved-view shape.
 */
export type SavedView = {
  id: string
  name: string
  filters: Record<string, unknown>
  sortField?: string | null
  sortDir?: 'asc' | 'desc' | null
  columns?: string[] | null
  isDefault: boolean
  isShared: boolean
  userId: string
  createdAt: string
  updatedAt?: string | null
}

export type SavedViewSaveInput = {
  name: string
  filters?: Record<string, unknown>
  sortField?: string | null
  sortDir?: 'asc' | 'desc' | null
  columns?: string[] | null
  isDefault?: boolean
  isShared?: boolean
}

type PerspectiveApiItem = {
  id: string
  name: string
  settings: PerspectiveSettings
  isDefault: boolean
  isShared?: boolean
  userId?: string
  createdAt: string
  updatedAt?: string | null
}

type PerspectiveApiResponse = {
  perspectives?: PerspectiveApiItem[]
  shared?: PerspectiveApiItem[]
}

function perspectiveToSavedView(item: PerspectiveApiItem): SavedView {
  const settings = item.settings ?? {}
  const sorting = Array.isArray(settings.sorting) ? settings.sorting[0] : undefined
  return {
    id: item.id,
    name: item.name,
    filters: settings.filters ?? {},
    sortField: sorting?.id ?? null,
    sortDir: sorting?.desc === true ? 'desc' : sorting?.id ? 'asc' : null,
    columns: settings.columnOrder ?? null,
    isDefault: item.isDefault,
    isShared: item.isShared ?? false,
    userId: item.userId ?? '',
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
}

function savedViewToSettings(input: SavedViewSaveInput): PerspectiveSettings {
  const settings: PerspectiveSettings = {}
  if (input.filters && Object.keys(input.filters).length > 0) {
    settings.filters = input.filters
  }
  if (input.sortField) {
    settings.sorting = [{ id: input.sortField, desc: input.sortDir === 'desc' }]
  }
  if (input.columns && input.columns.length > 0) {
    settings.columnOrder = input.columns
  }
  return settings
}

export type UseSavedViewsOptions = {
  /** Stable table identifier, e.g. 'customers:deal', 'sales:order' */
  tableId: string
  /** Called when a view is applied. Implement to update your page filters/sort/columns. */
  onApply?: (view: SavedView) => void
  /** Called when the view is cleared (back to default). */
  onClear?: () => void
  /** External reload dependency (e.g. org scope version) */
  reloadDeps?: unknown[]
}

export type UseSavedViewsResult = {
  views: SavedView[]
  sharedViews: SavedView[]
  selectedViewId: string
  isLoading: boolean
  selectView: (viewId: string) => void
  saveView: (input: SavedViewSaveInput) => Promise<boolean>
  deleteView: (viewId: string) => Promise<boolean>
  reload: () => void
}

/**
 * Generic hook for managing saved views on any DataTable list page.
 * Uses the perspectives API under the hood, converting between
 * PerspectiveSettings and the flat saved-view shape.
 *
 * Usage:
 * ```tsx
 * const { views, selectedViewId, selectView, saveView, deleteView } = useSavedViews({
 *   tableId: 'customers:deal',
 *   onApply: (view) => {
 *     setFilterValues(view.filters)
 *     setPage(1)
 *   },
 *   onClear: () => {
 *     setFilterValues({})
 *     setPage(1)
 *   },
 * })
 * ```
 */
export function useSavedViews(options: UseSavedViewsOptions): UseSavedViewsResult {
  const { tableId, onApply, onClear, reloadDeps = [] } = options
  const [views, setViews] = React.useState<SavedView[]>([])
  const [sharedViews, setSharedViews] = React.useState<SavedView[]>([])
  const [selectedViewId, setSelectedViewId] = React.useState('')
  const [isLoading, setIsLoading] = React.useState(false)
  const [reloadToken, setReloadToken] = React.useState(0)

  const encodedTableId = React.useMemo(() => encodeURIComponent(tableId), [tableId])

  const fetchViews = React.useCallback(async () => {
    if (!tableId) return
    setIsLoading(true)
    try {
      const call = await apiCall<PerspectiveApiResponse>(`/api/perspectives/${encodedTableId}`)
      if (!call.ok) return
      const personal = Array.isArray(call.result?.perspectives) ? call.result.perspectives : []
      const shared = Array.isArray(call.result?.shared) ? call.result.shared : []
      setViews(personal.map(perspectiveToSavedView))
      setSharedViews(shared.map(perspectiveToSavedView))
    } catch {
      // Silently fail — views are non-critical
    } finally {
      setIsLoading(false)
    }
  }, [tableId, encodedTableId])

  React.useEffect(() => {
    fetchViews()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchViews, reloadToken, ...reloadDeps])

  const selectView = React.useCallback((viewId: string) => {
    setSelectedViewId(viewId)
    if (!viewId) {
      onClear?.()
      return
    }
    const allViews = [...views, ...sharedViews]
    const view = allViews.find((v) => v.id === viewId)
    if (view) {
      onApply?.(view)
    }
  }, [views, sharedViews, onApply, onClear])

  const saveView = React.useCallback(async (input: SavedViewSaveInput): Promise<boolean> => {
    try {
      const call = await apiCall<{ perspective?: { id?: string } }>(`/api/perspectives/${encodedTableId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: input.name,
          settings: savedViewToSettings(input),
          isDefault: input.isDefault,
          isShared: input.isShared,
        }),
      })
      if (call.ok) {
        await fetchViews()
        return true
      }
      return false
    } catch {
      return false
    }
  }, [encodedTableId, fetchViews])

  const deleteView = React.useCallback(async (viewId: string): Promise<boolean> => {
    try {
      const call = await apiCall<{ ok?: boolean }>(`/api/perspectives/${encodedTableId}/${viewId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (call.ok) {
        if (selectedViewId === viewId) {
          setSelectedViewId('')
          onClear?.()
        }
        await fetchViews()
        return true
      }
      return false
    } catch {
      return false
    }
  }, [encodedTableId, selectedViewId, fetchViews, onClear])

  const reload = React.useCallback(() => {
    setReloadToken((prev) => prev + 1)
  }, [])

  return {
    views,
    sharedViews,
    selectedViewId,
    isLoading,
    selectView,
    saveView,
    deleteView,
    reload,
  }
}
