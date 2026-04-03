"use client"

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createTranslatorWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { createCrud, deleteCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import {
  ActivitiesSection as SharedActivitiesSection,
  type ActivitySummary,
  type ActivitiesDataAdapter,
  type SectionAction,
  type TabEmptyStateConfig,
} from '@open-mercato/ui/backend/detail'
import { renderDictionaryColor, renderDictionaryIcon } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import { createDictionarySelectLabels } from './utils'
import { ensureCustomerDictionary, invalidateCustomerDictionary, useCustomerDictionary } from './hooks/useCustomerDictionary'
import { CustomFieldValuesList } from './CustomFieldValuesList'
import { useCustomFieldDisplay } from './hooks/useCustomFieldDisplay'
import { E } from '#generated/entities.ids.generated'
import {
  CUSTOMER_INTERACTION_ENTITY_ID,
  mapInteractionRecordToActivitySummary,
} from '../../lib/interactionCompatibility'
import type { InteractionSummary } from './types'

type DictionaryOption = {
  value: string
  label: string
  color: string | null
  icon: string | null
}

type GuardedMutationRunner = <T>(
  operation: () => Promise<T>,
  mutationPayload?: Record<string, unknown>,
) => Promise<T>

export type ActivitiesSectionProps = {
  entityId: string | null
  dealId?: string | null
  useCanonicalInteractions?: boolean
  addActionLabel: string
  emptyState: TabEmptyStateConfig
  onActionChange?: (action: SectionAction | null) => void
  onLoadingChange?: (isLoading: boolean) => void
  onDataRefresh?: () => void
  dealOptions?: Array<{ id: string; label: string }>
  entityOptions?: Array<{ id: string; label: string }>
  defaultEntityId?: string | null
  runGuardedMutation?: GuardedMutationRunner
}

export function ActivitiesSection({
  entityId,
  dealId,
  useCanonicalInteractions = false,
  addActionLabel,
  emptyState,
  onActionChange,
  onLoadingChange,
  onDataRefresh,
  dealOptions,
  entityOptions,
  defaultEntityId,
  runGuardedMutation,
}: ActivitiesSectionProps) {
  const t = useT()
  const detailTranslator = React.useMemo(() => createTranslatorWithFallback(t), [t])
  const queryClient = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const dictionaryQuery = useCustomerDictionary('activity-types', scopeVersion)
  const dictionaryMap = dictionaryQuery.data?.map ?? {}
  const customFieldResources = useCustomFieldDisplay(
    useCanonicalInteractions ? CUSTOMER_INTERACTION_ENTITY_ID : E.customers.customer_activity,
  )
  const customFieldEmptyLabel = t('customers.people.detail.noValue', 'Not provided')

  const translate = React.useCallback(
    (key: string, fallback: string) => {
      const result = t(key)
      return result === key ? fallback : result
    },
    [t],
  )
  const runWriteMutation = React.useCallback(
    async <T,>(operation: () => Promise<T>, mutationPayload?: Record<string, unknown>): Promise<T> => {
      if (!runGuardedMutation) {
        return operation()
      }
      return runGuardedMutation(operation, mutationPayload)
    },
    [runGuardedMutation],
  )

  const activityTypeLabels = React.useMemo(
    () => createDictionarySelectLabels('activity-types', translate),
    [translate],
  )

  const loadActivityOptions = React.useCallback(async (): Promise<DictionaryOption[]> => {
    const data = await ensureCustomerDictionary(queryClient, 'activity-types', scopeVersion)
    return data.entries
      .filter((entry) => entry.value !== 'task')
      .map((entry) => ({
        value: entry.value,
        label: entry.label,
        color: entry.color ?? null,
        icon: entry.icon ?? null,
      }))
  }, [queryClient, scopeVersion])

  const createActivityOption = React.useCallback(
    async (input: { value: string; label?: string; color?: string | null; icon?: string | null }) => {
      const requestPayload = {
        value: input.value,
        label: input.label ?? undefined,
        color: input.color ?? undefined,
        icon: input.icon ?? undefined,
      }
      const response = await runWriteMutation(
        () => apiCallOrThrow<Record<string, unknown>>(
          '/api/customers/dictionaries/activity-types',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(requestPayload),
          },
          { errorMessage: translate('customers.people.form.dictionary.error', 'Failed to save option') },
        ),
        requestPayload,
      )
      const resultPayload = response.result ?? {}
      const valueCreated =
        typeof resultPayload.value === 'string' && resultPayload.value.trim().length
          ? resultPayload.value.trim()
          : input.value
      const label =
        typeof resultPayload.label === 'string' && resultPayload.label.trim().length
          ? resultPayload.label.trim()
          : valueCreated
      const color =
        typeof resultPayload.color === 'string' && resultPayload.color.trim().startsWith('#')
          ? resultPayload.color.trim()
          : input.color ?? null
      const icon =
        typeof resultPayload.icon === 'string' && resultPayload.icon.trim().length
          ? resultPayload.icon.trim()
          : input.icon ?? null
      await invalidateCustomerDictionary(queryClient, 'activity-types')
      return { value: valueCreated, label, color, icon }
    },
    [queryClient, runWriteMutation, translate],
  )

  const activitiesAdapter = React.useMemo<ActivitiesDataAdapter>(() => ({
    list: async ({ entityId: listEntityId, dealId: listDealId }) => {
      if (useCanonicalInteractions) {
        const params = new URLSearchParams({
          limit: '50',
          sortField: 'occurredAt',
          sortDir: 'desc',
          excludeInteractionType: 'task',
        })
        if (listEntityId) params.set('entityId', listEntityId)
        if (listDealId) params.set('dealId', listDealId)
        const payload = await readApiResultOrThrow<{ items?: InteractionSummary[] }>(
          `/api/customers/interactions?${params.toString()}`,
          undefined,
          { errorMessage: translate('customers.people.detail.activities.loadError', 'Failed to load activities.') },
        )
        const items = Array.isArray(payload?.items) ? payload.items : []
        return items.map((interaction) => mapInteractionRecordToActivitySummary(interaction))
      }

      const params = new URLSearchParams({
        pageSize: '50',
        sortField: 'occurredAt',
        sortDir: 'desc',
      })
      if (listEntityId) params.set('entityId', listEntityId)
      if (listDealId) params.set('dealId', listDealId)
      const payload = await readApiResultOrThrow<Record<string, unknown>>(
        `/api/customers/activities?${params.toString()}`,
        undefined,
        { errorMessage: translate('customers.people.detail.activities.loadError', 'Failed to load activities.') },
      )
      return Array.isArray(payload?.items) ? (payload.items as ActivitySummary[]) : []
    },
    create: async ({ entityId: payloadEntityId, dealId: payloadDealId, ...payload }) => {
      if (useCanonicalInteractions) {
        const interactionPayload = {
          entityId: payloadEntityId,
          interactionType: payload.activityType,
          title: payload.subject ?? undefined,
          body: payload.body ?? undefined,
          occurredAt: payload.occurredAt ?? undefined,
          status: payload.occurredAt ? 'done' : 'planned',
          dealId: payloadDealId ?? undefined,
          ...(payload.customFields ? { customFields: payload.customFields } : {}),
        }
        await runWriteMutation(
          () => createCrud(
            'customers/interactions',
            interactionPayload,
            {
              errorMessage: translate('customers.people.detail.activities.error', 'Failed to save activity'),
            },
          ),
          interactionPayload,
        )
        onDataRefresh?.()
        return
      }

      const activityPayload = {
        entityId: payloadEntityId,
        activityType: payload.activityType,
        subject: payload.subject ?? undefined,
        body: payload.body ?? undefined,
        occurredAt: payload.occurredAt ?? undefined,
        dealId: payloadDealId ?? undefined,
        ...(payload.customFields ? { customFields: payload.customFields } : {}),
      }
      await runWriteMutation(
        () => createCrud(
          'customers/activities',
          activityPayload,
          {
            errorMessage: translate('customers.people.detail.activities.error', 'Failed to save activity'),
          },
        ),
        activityPayload,
      )
      onDataRefresh?.()
    },
    update: async ({ id, patch }) => {
      if (useCanonicalInteractions) {
        const interactionPatch = {
          id,
          interactionType: patch.activityType,
          title: patch.subject ?? undefined,
          body: patch.body ?? undefined,
          occurredAt: patch.occurredAt ?? undefined,
          status: patch.occurredAt ? 'done' : undefined,
          dealId: patch.dealId ?? undefined,
          ...(patch.customFields ? { customFields: patch.customFields } : {}),
        }
        await runWriteMutation(
          () => updateCrud(
            'customers/interactions',
            interactionPatch,
            {
              errorMessage: translate('customers.people.detail.activities.error', 'Failed to save activity'),
            },
          ),
          interactionPatch,
        )
        onDataRefresh?.()
        return
      }

      const activityPatch = {
        id,
        entityId: patch.entityId,
        activityType: patch.activityType,
        subject: patch.subject ?? undefined,
        body: patch.body ?? undefined,
        occurredAt: patch.occurredAt ?? undefined,
        dealId: patch.dealId ?? undefined,
        ...(patch.customFields ? { customFields: patch.customFields } : {}),
      }
      await runWriteMutation(
        () => updateCrud(
          'customers/activities',
          activityPatch,
          {
            errorMessage: translate('customers.people.detail.activities.error', 'Failed to save activity'),
          },
        ),
        activityPatch,
      )
      onDataRefresh?.()
    },
    delete: async ({ id }) => {
      if (useCanonicalInteractions) {
        const deletePayload = { id }
        await runWriteMutation(
          () => deleteCrud('customers/interactions', {
            id,
            errorMessage: translate('customers.people.detail.activities.deleteError', 'Failed to delete activity.'),
          }),
          deletePayload,
        )
        onDataRefresh?.()
        return
      }

      const deletePayload = { id }
      await runWriteMutation(
        () => deleteCrud('customers/activities', {
          id,
          errorMessage: translate('customers.people.detail.activities.deleteError', 'Failed to delete activity.'),
        }),
        deletePayload,
      )
      onDataRefresh?.()
    },
  }), [onDataRefresh, runWriteMutation, translate, useCanonicalInteractions])

  const resolveActivityPresentation = React.useCallback((activity: ActivitySummary) => {
    const entry = dictionaryMap[activity.activityType]
    return {
      label: entry?.label ?? activity.activityType,
      icon: entry?.icon ?? activity.appearanceIcon ?? null,
      color: entry?.color ?? activity.appearanceColor ?? null,
    }
  }, [dictionaryMap])

  const renderCustomFields = React.useCallback((activity: ActivitySummary) => {
    const customEntries = Array.isArray(activity.customFields) ? activity.customFields : []
    return (
      <CustomFieldValuesList
        entries={customEntries.map((entry) => ({
          key: entry.key,
          value: entry.value,
          label: entry.label,
        }))}
        values={activity.customValues ?? undefined}
        resources={customFieldResources}
        emptyLabel={customFieldEmptyLabel}
        itemKeyPrefix={`activity-${activity.id}-field`}
      />
    )
  }, [customFieldEmptyLabel, customFieldResources])

  const appearanceLabels = React.useMemo(() => ({
    colorLabel: t('customers.config.dictionaries.dialog.colorLabel', 'Color'),
    colorHelp: t('customers.config.dictionaries.dialog.colorHelp', 'Pick a highlight color for this entry.'),
    colorClearLabel: t('customers.config.dictionaries.dialog.colorClear', 'Remove color'),
    iconLabel: t('customers.config.dictionaries.dialog.iconLabel', 'Icon or emoji'),
    iconPlaceholder: t('customers.config.dictionaries.dialog.iconPlaceholder', 'Type an emoji or pick one of the suggestions.'),
    iconPickerTriggerLabel: t('customers.config.dictionaries.dialog.iconBrowse', 'Browse icons and emojis'),
    iconSearchPlaceholder: t('customers.config.dictionaries.dialog.iconSearchPlaceholder', 'Search icons or emojis...'),
    iconSearchEmptyLabel: t('customers.config.dictionaries.dialog.iconSearchEmpty', 'No icons match your search.'),
    iconSuggestionsLabel: t('customers.config.dictionaries.dialog.iconSuggestions', 'Suggestions'),
    iconClearLabel: t('customers.config.dictionaries.dialog.iconClear', 'Remove icon'),
    previewEmptyLabel: t('customers.config.dictionaries.dialog.previewEmpty', 'No appearance selected'),
  }), [t])

  const sortActivitiesSoonestFirst = React.useCallback((items: ActivitySummary[]): ActivitySummary[] => {
    const toTimestamp = (value: string | null | undefined): number | null => {
      if (!value) return null
      const timestamp = Date.parse(value)
      return Number.isNaN(timestamp) ? null : timestamp
    }

    const referenceTime = Date.now()

    const getSortKey = (activity: ActivitySummary): { bucket: number; time: number; createdAt: number } => {
      const primaryTimestamp = toTimestamp(activity.occurredAt ?? activity.createdAt)
      const createdAtTimestamp = toTimestamp(activity.createdAt) ?? Number.POSITIVE_INFINITY

      if (primaryTimestamp === null) {
        return { bucket: 2, time: Number.POSITIVE_INFINITY, createdAt: createdAtTimestamp }
      }

      if (primaryTimestamp >= referenceTime) {
        return { bucket: 0, time: primaryTimestamp, createdAt: createdAtTimestamp }
      }

      return { bucket: 1, time: -primaryTimestamp, createdAt: createdAtTimestamp }
    }

    return [...items].sort((left, right) => {
      const leftKey = getSortKey(left)
      const rightKey = getSortKey(right)
      if (leftKey.bucket !== rightKey.bucket) return leftKey.bucket - rightKey.bucket
      if (leftKey.time !== rightKey.time) return leftKey.time - rightKey.time
      if (leftKey.createdAt !== rightKey.createdAt) return leftKey.createdAt - rightKey.createdAt
      return left.id.localeCompare(right.id)
    })
  }, [])

  const sortedActivitiesAdapter = React.useMemo<ActivitiesDataAdapter>(() => ({
    ...activitiesAdapter,
    list: async (params) => sortActivitiesSoonestFirst(await activitiesAdapter.list(params)),
  }), [activitiesAdapter, sortActivitiesSoonestFirst])

  const customFieldEntityIds = React.useMemo(
    () => [useCanonicalInteractions ? CUSTOMER_INTERACTION_ENTITY_ID : 'customers:customer_activity'],
    [useCanonicalInteractions],
  )

  return (
    <SharedActivitiesSection
      entityId={entityId}
      dealId={dealId}
      dealOptions={dealOptions}
      entityOptions={entityOptions}
      defaultEntityId={defaultEntityId ?? undefined}
      addActionLabel={addActionLabel}
      emptyState={emptyState}
      onActionChange={onActionChange}
      onLoadingChange={onLoadingChange}
      dataAdapter={sortedActivitiesAdapter}
      activityTypeLabels={activityTypeLabels}
      loadActivityOptions={loadActivityOptions}
      createActivityOption={createActivityOption}
      resolveActivityPresentation={resolveActivityPresentation}
      renderCustomFields={renderCustomFields}
      renderIcon={renderDictionaryIcon}
      renderColor={renderDictionaryColor}
      manageHref="/backend/config/customers"
      appearanceLabels={appearanceLabels}
      customFieldEntityIds={customFieldEntityIds}
    />
  )
}

export default ActivitiesSection
