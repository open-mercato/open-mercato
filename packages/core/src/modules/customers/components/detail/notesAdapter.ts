"use client"

import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { mapCommentSummary, type NotesDataAdapter } from '@open-mercato/ui/backend/detail/NotesSection'

type Translator = (key: string, fallback?: string, params?: Record<string, string | number>) => string

export type CustomerNotesGuardedMutation = <T>(
  runner: () => Promise<T>,
  payload?: Record<string, unknown>,
) => Promise<T>

export type CreateCustomerNotesAdapterOptions = {
  /**
   * Threads writes through a guarded mutation runner (typically
   * `useGuardedMutation(...).runMutation` wrapped with retry context).
   * When provided, the runner enables record-lock conflict retry and
   * ensures global injection modules receive the mutation lifecycle.
   */
  runMutation?: CustomerNotesGuardedMutation
}

export function createCustomerNotesAdapter(
  translator: Translator,
  options: CreateCustomerNotesAdapterOptions = {},
): NotesDataAdapter {
  const runWrite = async <T>(
    runner: () => Promise<T>,
    payload: Record<string, unknown>,
  ): Promise<T> => {
    if (options.runMutation) {
      return options.runMutation(runner, payload)
    }
    return runner()
  }
  return {
    list: async ({ entityId, dealId }) => {
      const params = new URLSearchParams()
      if (entityId) params.set('entityId', entityId)
      if (dealId) params.set('dealId', dealId)
      const payload = await readApiResultOrThrow<Record<string, unknown>>(
        `/api/customers/comments?${params.toString()}`,
        undefined,
        { errorMessage: translator('customers.people.detail.notes.loadError', 'Failed to load notes.') },
      )
      const items = Array.isArray(payload?.items) ? payload.items : []
      return items.map(mapCommentSummary)
    },
    listPage: async ({ entityId, dealId, page, pageSize }) => {
      const params = new URLSearchParams()
      if (entityId) params.set('entityId', entityId)
      if (dealId) params.set('dealId', dealId)
      params.set('page', String(page))
      params.set('pageSize', String(pageSize))
      const payload = await readApiResultOrThrow<Record<string, unknown>>(
        `/api/customers/comments?${params.toString()}`,
        undefined,
        { errorMessage: translator('customers.people.detail.notes.loadError', 'Failed to load notes.') },
      )
      const items = Array.isArray(payload?.items) ? payload.items.map(mapCommentSummary) : []
      const total = typeof payload?.total === 'number' ? payload.total : items.length
      const totalPages = typeof payload?.totalPages === 'number' ? payload.totalPages : Math.max(1, Math.ceil(total / pageSize))
      const resolvedPage = typeof payload?.page === 'number' ? payload.page : page
      const resolvedPageSize = typeof payload?.pageSize === 'number' ? payload.pageSize : pageSize
      return {
        items,
        total,
        page: resolvedPage,
        pageSize: resolvedPageSize,
        totalPages,
      }
    },
    create: async ({ entityId, body, appearanceIcon, appearanceColor, dealId }) => {
      const requestBody = {
        entityId,
        body,
        appearanceIcon: appearanceIcon ?? undefined,
        appearanceColor: appearanceColor ?? undefined,
        dealId: dealId ?? undefined,
      }
      const response = await runWrite(
        () => apiCallOrThrow<Record<string, unknown>>(
          '/api/customers/comments',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(requestBody),
          },
          { errorMessage: translator('customers.people.detail.notes.error') },
        ),
        { operation: 'createNote', entityId, dealId: dealId ?? null },
      )
      return response.result ?? {}
    },
    update: async ({ id, patch }) => {
      const payload: Record<string, unknown> = { id }
      if (patch.body !== undefined) payload.body = patch.body
      if (patch.appearanceIcon !== undefined) payload.appearanceIcon = patch.appearanceIcon
      if (patch.appearanceColor !== undefined) payload.appearanceColor = patch.appearanceColor
      await runWrite(
        () => apiCallOrThrow(
          '/api/customers/comments',
          {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          },
          { errorMessage: translator('customers.people.detail.notes.updateError') },
        ),
        { operation: 'updateNote', id },
      )
    },
    delete: async ({ id }) => {
      await runWrite(
        () => apiCallOrThrow(
          `/api/customers/comments?id=${encodeURIComponent(id)}`,
          {
            method: 'DELETE',
            headers: { 'content-type': 'application/json' },
          },
          { errorMessage: translator('customers.people.detail.notes.deleteError', 'Failed to delete note') },
        ),
        { operation: 'deleteNote', id },
      )
    },
  }
}
