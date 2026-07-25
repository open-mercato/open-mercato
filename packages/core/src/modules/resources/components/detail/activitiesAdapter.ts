"use client"

import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import type { ActivitiesDataAdapter, ActivitySummary } from '@open-mercato/ui/backend/detail'

type Translator = (key: string, fallback?: string, params?: Record<string, string | number>) => string

export type ResourceActivitiesGuardedMutation = <T>(
  runner: () => Promise<T>,
  payload?: Record<string, unknown>,
) => Promise<T>

export type CreateResourceActivitiesAdapterOptions = {
  runMutation?: ResourceActivitiesGuardedMutation
}

export function createResourceActivitiesAdapter(
  translator: Translator,
  options: CreateResourceActivitiesAdapterOptions = {},
): ActivitiesDataAdapter {
  const runWrite = async <T,>(
    runner: () => Promise<T>,
    payload: Record<string, unknown>,
  ): Promise<T> => {
    if (options.runMutation) {
      return options.runMutation(runner, payload)
    }
    return runner()
  }

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
      const payload = {
        entityId,
        activityType,
        subject: subject ?? undefined,
        body: body ?? undefined,
        occurredAt: occurredAt ?? undefined,
        ...(customFields ? { customFields } : {}),
      }
      await runWrite(
        () => createCrud('resources/activities', payload, {
          errorMessage: translator('resources.resources.detail.activities.error', 'Failed to save activity'),
        }),
        { operation: 'createActivity', entityId, activityType },
      )
    },
    update: async ({ id, patch }) => {
      const payload = {
        id,
        entityId: patch.entityId,
        activityType: patch.activityType,
        subject: patch.subject ?? undefined,
        body: patch.body ?? undefined,
        occurredAt: patch.occurredAt ?? undefined,
        ...(patch.customFields ? { customFields: patch.customFields } : {}),
      }
      await runWrite(
        () => updateCrud('resources/activities', payload, {
          errorMessage: translator('resources.resources.detail.activities.error', 'Failed to save activity'),
        }),
        { operation: 'updateActivity', id },
      )
    },
    delete: async ({ id }) => {
      await runWrite(
        () => deleteCrud('resources/activities', {
          id,
          errorMessage: translator('resources.resources.detail.activities.deleteError', 'Failed to delete activity.'),
        }),
        { operation: 'deleteActivity', id },
      )
    },
  }
}
