"use client"

import * as React from 'react'
import { readApiResultOrThrow, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

export type CrudSectionState<T> = {
  items: T[]
  isLoading: boolean
  error: string | null
  editingId: string | null
  isSubmitting: boolean
  showForm: boolean
}

export type CrudSectionActions<T> = {
  setEditingId: (id: string | null) => void
  setShowForm: (show: boolean) => void
  reload: () => Promise<void>
  setItems: React.Dispatch<React.SetStateAction<T[]>>
  setIsSubmitting: (submitting: boolean) => void
  setError: (error: string | null) => void
  handleCreate: (data: Partial<T>) => Promise<void>
  handleUpdate: (id: string, data: Partial<T>) => Promise<void>
  handleDelete: (id: string) => Promise<void>
}

export type UseCrudSectionResult<T> = CrudSectionState<T> & CrudSectionActions<T>

export type UseCrudSectionOptions = {
  fetchUrl: string
  /** Extract items array from the API response (default: treat response as array) */
  extractItems?: (response: unknown) => unknown[]
  /** Error message for failed loads */
  errorMessage?: string
  /** Whether to load automatically on mount (default: true) */
  autoLoad?: boolean
}

/**
 * Reusable hook for CRUD section state management.
 * Manages loading, error, editing, and form visibility state.
 */
export function useCrudSection<T extends { id: string }>(
  options: UseCrudSectionOptions,
): UseCrudSectionResult<T> {
  const { fetchUrl, extractItems, errorMessage = 'Failed to load data.', autoLoad = true } = options
  const [items, setItems] = React.useState<T[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [showForm, setShowForm] = React.useState(false)

  const reload = React.useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await readApiResultOrThrow<unknown>(fetchUrl, undefined, { errorMessage })
      const extracted = extractItems ? extractItems(result) : result
      setItems((Array.isArray(extracted) ? extracted : []) as T[])
    } catch (err) {
      const msg = err instanceof Error ? err.message : errorMessage
      setError(msg)
    } finally {
      setIsLoading(false)
    }
  }, [fetchUrl, extractItems, errorMessage])

  React.useEffect(() => {
    if (autoLoad) {
      reload()
    }
  }, [autoLoad, reload])

  const handleCreate = React.useCallback(async (data: Partial<T>) => {
    setIsSubmitting(true)
    setError(null)
    try {
      await apiCallOrThrow(fetchUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      setShowForm(false)
      await reload()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create.'
      setError(msg)
      throw err
    } finally {
      setIsSubmitting(false)
    }
  }, [fetchUrl, reload])

  const handleUpdate = React.useCallback(async (id: string, data: Partial<T>) => {
    setIsSubmitting(true)
    setError(null)
    try {
      await apiCallOrThrow(`${fetchUrl}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      setEditingId(null)
      await reload()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update.'
      setError(msg)
      throw err
    } finally {
      setIsSubmitting(false)
    }
  }, [fetchUrl, reload])

  const handleDelete = React.useCallback(async (id: string) => {
    setIsSubmitting(true)
    setError(null)
    try {
      await apiCallOrThrow(`${fetchUrl}/${id}`, { method: 'DELETE' })
      await reload()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete.'
      setError(msg)
      throw err
    } finally {
      setIsSubmitting(false)
    }
  }, [fetchUrl, reload])

  return {
    items,
    isLoading,
    error,
    editingId,
    isSubmitting,
    showForm,
    setEditingId,
    setShowForm,
    reload,
    setItems,
    setIsSubmitting,
    setError,
    handleCreate,
    handleUpdate,
    handleDelete,
  }
}
