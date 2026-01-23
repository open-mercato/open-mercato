"use client"

import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import type { ActivitiesDataAdapter, ActivitySummary } from '@open-mercato/ui/backend/detail'

type Translator = (key: string, fallback?: string, params?: Record<string, string | number>) => string

export function createResourceActivitiesAdapter(translator: Translator): ActivitiesDataAdapter {
  return {
    list: async ({ entityId }) => {
      const params = new URLSearchParams({
        pageSize: '50',
        sortField: 'occurredAt',
        sortDir: 'desc',
      })
      if (entityId) params.set('entityId', entityId)
      const payload = await readApiResultOrThrow<Record<string, unknown>>(
        `/api/resources/activities?${params.toString()}`,
        undefined,
        { errorMessage: translator('resources.resources.detail.activities.loadError', 'Failed to load activities.') },
      )
      return Array.isArray(payload?.items) ? (payload.items as ActivitySummary[]) : []
    },
    create: async ({ entityId, activityType, subject, body, occurredAt, customFields }) => {
      await createCrud('resources/activities', {
        entityId,
        activityType,
        subject: subject ?? undefined,
        body: body ?? undefined,
        occurredAt: occurredAt ?? undefined,
        ...(customFields ? { customFields } : {}),
      }, {
        errorMessage: translator('resources.resources.detail.activities.error', 'Failed to save activity'),
      })
    },
    update: async ({ id, patch }) => {
      await updateCrud('resources/activities', {
        id,
        entityId: patch.entityId,
        activityType: patch.activityType,
        subject: patch.subject ?? undefined,
        body: patch.body ?? undefined,
        occurredAt: patch.occurredAt ?? undefined,
        ...(patch.customFields ? { customFields: patch.customFields } : {}),
      }, {
        errorMessage: translator('resources.resources.detail.activities.error', 'Failed to save activity'),
      })
    },
    delete: async ({ id }) => {
      await deleteCrud('resources/activities', {
        id,
        errorMessage: translator('resources.resources.detail.activities.deleteError', 'Failed to delete activity.'),
      })
    },
  }
}
