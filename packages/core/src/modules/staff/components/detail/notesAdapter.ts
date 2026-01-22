"use client"

import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { mapCommentSummary, type NotesDataAdapter } from '@open-mercato/ui/backend/detail/NotesSection'

type Translator = (key: string, fallback?: string, params?: Record<string, string | number>) => string

export function createStaffNotesAdapter(translator: Translator): NotesDataAdapter {
  return {
    list: async ({ entityId }) => {
      const params = new URLSearchParams()
      if (entityId) params.set('entityId', entityId)
      const payload = await readApiResultOrThrow<Record<string, unknown>>(
        `/api/staff/comments?${params.toString()}`,
        undefined,
        { errorMessage: translator('staff.teamMembers.detail.notes.loadError', 'Failed to load notes.') },
      )
      const items = Array.isArray(payload?.items) ? payload.items : []
      return items.map(mapCommentSummary)
    },
    create: async ({ entityId, body, appearanceIcon, appearanceColor }) => {
      const response = await apiCallOrThrow<Record<string, unknown>>(
        '/api/staff/comments',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            entityId,
            body,
            appearanceIcon: appearanceIcon ?? undefined,
            appearanceColor: appearanceColor ?? undefined,
          }),
        },
        { errorMessage: translator('staff.teamMembers.detail.notes.error', 'Failed to save note.') },
      )
      return response.result ?? {}
    },
    update: async ({ id, patch }) => {
      const payload: Record<string, unknown> = { id }
      if (patch.body !== undefined) payload.body = patch.body
      if (patch.appearanceIcon !== undefined) payload.appearanceIcon = patch.appearanceIcon
      if (patch.appearanceColor !== undefined) payload.appearanceColor = patch.appearanceColor
      await apiCallOrThrow(
        '/api/staff/comments',
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        },
        { errorMessage: translator('staff.teamMembers.detail.notes.updateError', 'Failed to update note.') },
      )
    },
    delete: async ({ id }) => {
      await apiCallOrThrow(
        `/api/staff/comments?id=${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
        },
        { errorMessage: translator('staff.teamMembers.detail.notes.deleteError', 'Failed to delete note') },
      )
    },
  }
}
