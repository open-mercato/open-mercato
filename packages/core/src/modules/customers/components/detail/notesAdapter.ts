"use client"

import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { mapCommentSummary, type NotesDataAdapter } from '@open-mercato/ui/backend/detail/NotesSection'

type Translator = (key: string, fallback?: string, params?: Record<string, string | number>) => string

export function createCustomerNotesAdapter(translator: Translator): NotesDataAdapter {
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
    create: async ({ entityId, body, appearanceIcon, appearanceColor, dealId }) => {
      const response = await apiCallOrThrow<Record<string, unknown>>(
        '/api/customers/comments',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            entityId,
            body,
            appearanceIcon: appearanceIcon ?? undefined,
            appearanceColor: appearanceColor ?? undefined,
            dealId: dealId ?? undefined,
          }),
        },
        { errorMessage: translator('customers.people.detail.notes.error') },
      )
      return response.result ?? {}
    },
    update: async ({ id, patch }) => {
      const payload: Record<string, unknown> = { id }
      if (patch.body !== undefined) payload.body = patch.body
      if (patch.appearanceIcon !== undefined) payload.appearanceIcon = patch.appearanceIcon
      if (patch.appearanceColor !== undefined) payload.appearanceColor = patch.appearanceColor
      await apiCallOrThrow(
        '/api/customers/comments',
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        },
        { errorMessage: translator('customers.people.detail.notes.updateError') },
      )
    },
    delete: async ({ id }) => {
      await apiCallOrThrow(
        `/api/customers/comments?id=${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
        },
        { errorMessage: translator('customers.people.detail.notes.deleteError', 'Failed to delete note') },
      )
    },
  }
}
