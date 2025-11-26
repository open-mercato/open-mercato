"use client"

import * as React from 'react'
import Link from 'next/link'
import { ArrowUpRightSquare, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, deleteCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { useQueryClient } from '@tanstack/react-query'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { useT } from '@/lib/i18n/context'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { formatDateTime, createDictionarySelectLabels } from './utils'
import type { ActivitySummary, SectionAction, TabEmptyState } from './types'
import type { ActivityFormBaseValues, ActivityFormSubmitPayload } from './ActivityForm'
import {
  ensureCustomerDictionary,
  invalidateCustomerDictionary,
  useCustomerDictionary,
} from './hooks/useCustomerDictionary'
import { TimelineItemHeader } from './TimelineItemHeader'
import { ActivityDialog } from './ActivityDialog'
import { CustomFieldValuesList } from './CustomFieldValuesList'
import { useCustomFieldDisplay } from './hooks/useCustomFieldDisplay'
import { LoadingMessage } from './LoadingMessage'

type DictionaryOption = {
  value: string
  label: string
  color: string | null
  icon: string | null
}

type PendingAction =
  | { kind: 'create' }
  | { kind: 'update'; id: string }
  | { kind: 'delete'; id: string }

export type ActivitiesSectionProps = {
  entityId: string | null
  dealId?: string | null
  addActionLabel: string
  emptyState: TabEmptyState
  onActionChange?: (action: SectionAction | null) => void
  onLoadingChange?: (isLoading: boolean) => void
  dealOptions?: Array<{ id: string; label: string }>
  entityOptions?: Array<{ id: string; label: string }>
  defaultEntityId?: string | null
}

export function ActivitiesSection({
  entityId,
  dealId,
  addActionLabel,
  emptyState,
  onActionChange,
  onLoadingChange,
  dealOptions,
  entityOptions,
  defaultEntityId,
}: ActivitiesSectionProps) {
  const t = useT()
  const resolvedDefaultEntityId = React.useMemo(() => {
    const primary = typeof entityId === 'string' ? entityId.trim() : ''
    if (primary.length) return primary
    const fallback = typeof defaultEntityId === 'string' ? defaultEntityId.trim() : ''
    if (fallback.length) return fallback
    if (Array.isArray(entityOptions)) {
      for (const option of entityOptions) {
        if (!option || typeof option !== 'object') continue
        const id = typeof option.id === 'string' ? option.id.trim() : ''
        if (id.length) return id
      }
    }
    return ''
  }, [defaultEntityId, entityId, entityOptions])

  const resolveEntityForSubmission = React.useCallback(
    (input?: string | null) => {
      const candidate = typeof input === 'string' ? input.trim() : ''
      if (candidate.length) return candidate
      return resolvedDefaultEntityId.length ? resolvedDefaultEntityId : null
    },
    [resolvedDefaultEntityId],
  )
  const queryClient = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const dictionaryQuery = useCustomerDictionary('activity-types', scopeVersion)
  const dictionaryMap = dictionaryQuery.data?.map ?? {}
  const customFieldResources = useCustomFieldDisplay(E.customers.customer_activity)
  const customFieldEmptyLabel = t('customers.people.detail.noValue', 'Not provided')
  const [activities, setActivities] = React.useState<ActivitySummary[]>([])
  const [isLoading, setIsLoading] = React.useState<boolean>(() => {
    const entity = typeof entityId === 'string' ? entityId.trim() : ''
    const deal = typeof dealId === 'string' ? dealId.trim() : ''
    return Boolean(entity || deal || resolvedDefaultEntityId)
  })
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [pendingAction, setPendingAction] = React.useState<PendingAction | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [dialogMode, setDialogMode] = React.useState<'create' | 'edit'>('create')
  const [editingActivityId, setEditingActivityId] = React.useState<string | null>(null)
  const [initialValues, setInitialValues] = React.useState<Partial<ActivityFormBaseValues & Record<string, unknown>> | undefined>(undefined)
  const [visibleCount, setVisibleCount] = React.useState(0)
  const pendingCounterRef = React.useRef(0)

  const translate = React.useCallback(
    (key: string, fallback: string) => {
      const result = t(key)
      return result === key ? fallback : result
    },
    [t],
  )

  const activityTypeLabels = React.useMemo(
    () => createDictionarySelectLabels('activity-types', translate),
    [translate],
  )

  const pushLoading = React.useCallback(() => {
    pendingCounterRef.current += 1
    if (pendingCounterRef.current === 1) {
      onLoadingChange?.(true)
    }
  }, [onLoadingChange])

  const popLoading = React.useCallback(() => {
    pendingCounterRef.current = Math.max(0, pendingCounterRef.current - 1)
    if (pendingCounterRef.current === 0) {
      onLoadingChange?.(false)
    }
  }, [onLoadingChange])

  const loadDictionaryOptions = React.useCallback(async (): Promise<DictionaryOption[]> => {
    const data = await ensureCustomerDictionary(queryClient, 'activity-types', scopeVersion)
    return data.entries.map((entry) => ({
      value: entry.value,
      label: entry.label,
      color: entry.color ?? null,
      icon: entry.icon ?? null,
    }))
  }, [queryClient, scopeVersion])

  const createDictionaryOption = React.useCallback(
    async (
      input: { value: string; label?: string; color?: string | null; icon?: string | null },
    ): Promise<DictionaryOption> => {
      const response = await apiCallOrThrow<Record<string, unknown>>(
        '/api/customers/dictionaries/activity-types',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            value: input.value,
            label: input.label ?? undefined,
            color: input.color ?? undefined,
            icon: input.icon ?? undefined,
          }),
        },
        { errorMessage: translate('customers.people.form.dictionary.error', 'Failed to save option') },
      )
      const payload = response.result ?? {}
      const valueCreated =
        typeof payload.value === 'string' && payload.value.trim().length
          ? payload.value.trim()
          : input.value
      const label =
        typeof payload.label === 'string' && payload.label.trim().length
          ? payload.label.trim()
          : valueCreated
      const color =
        typeof payload.color === 'string' && payload.color.trim().startsWith('#')
          ? payload.color.trim()
          : input.color ?? null
      const icon =
        typeof payload.icon === 'string' && payload.icon.trim().length
          ? payload.icon.trim()
          : input.icon ?? null
      await invalidateCustomerDictionary(queryClient, 'activity-types')
      return { value: valueCreated, label, color, icon }
    },
    [queryClient, translate],
  )

  const updateVisibleCount = React.useCallback((length: number) => {
    if (!length) {
      setVisibleCount(0)
      return
    }
    const baseline = Math.min(5, length)
    setVisibleCount((prev) => {
      if (prev >= length) {
        return Math.min(prev, length)
      }
      return Math.min(Math.max(prev, baseline), length)
    })
  }, [])

  const loadActivities = React.useCallback(async () => {
    const queryEntityId = typeof entityId === 'string' ? entityId.trim() : ''
    const queryDealId = typeof dealId === 'string' ? dealId.trim() : ''
    if (!queryEntityId && !queryDealId) {
      setActivities([])
      setLoadError(null)
      updateVisibleCount(0)
      return
    }
    pushLoading()
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        pageSize: '50',
        sortField: 'occurredAt',
        sortDir: 'desc',
      })
      if (queryEntityId) params.set('entityId', queryEntityId)
      if (queryDealId) params.set('dealId', queryDealId)
      const payload = await readApiResultOrThrow<Record<string, unknown>>(
        `/api/customers/activities?${params.toString()}`,
        undefined,
        { errorMessage: t('customers.people.detail.activities.loadError', 'Failed to load activities.') },
      )
      const items = Array.isArray(payload?.items) ? (payload.items as ActivitySummary[]) : []
      setActivities(items)
      setLoadError(null)
      updateVisibleCount(items.length)
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t('customers.people.detail.activities.loadError', 'Failed to load activities.')
      setLoadError(message)
    } finally {
      setIsLoading(false)
      popLoading()
    }
  }, [dealId, entityId, popLoading, pushLoading, t, updateVisibleCount])

  React.useEffect(() => {
    updateVisibleCount(activities.length)
  }, [activities.length, updateVisibleCount])

  React.useEffect(() => {
    const queryEntityId = typeof entityId === 'string' ? entityId.trim() : ''
    const queryDealId = typeof dealId === 'string' ? dealId.trim() : ''
    if (!queryEntityId && !queryDealId) {
      setActivities([])
      setLoadError(null)
      setIsLoading(false)
      pendingCounterRef.current = 0
      onLoadingChange?.(false)
      updateVisibleCount(0)
      return
    }
    loadActivities().catch(() => {})
  }, [dealId, entityId, loadActivities, onLoadingChange, updateVisibleCount])

  const openCreateDialog = React.useCallback(() => {
    setDialogMode('create')
    setEditingActivityId(null)
    setInitialValues(undefined)
    setDialogOpen(true)
  }, [])

  const openEditDialog = React.useCallback((activity: ActivitySummary) => {
    setDialogMode('edit')
    setEditingActivityId(activity.id)
    const baseValues: Partial<ActivityFormBaseValues & Record<string, unknown>> = {
      activityType: activity.activityType,
      subject: activity.subject ?? '',
      body: activity.body ?? '',
      occurredAt: activity.occurredAt ?? activity.createdAt ?? null,
      dealId: activity.dealId ?? '',
      entityId: activity.entityId ?? '',
    }
    const customEntries = Array.isArray(activity.customFields) ? activity.customFields : []
    customEntries.forEach((entry) => {
      if (entry.key === 'entityId' || entry.key === 'dealId') return
      baseValues[`cf_${entry.key}`] = entry.value ?? null
    })
    setInitialValues(baseValues)
    setDialogOpen(true)
  }, [])

  const closeDialog = React.useCallback(() => {
    setDialogOpen(false)
    setDialogMode('create')
    setEditingActivityId(null)
    setInitialValues(undefined)
  }, [])

  const handleDialogOpenChange = React.useCallback(
    (next: boolean) => {
      if (!next) {
        closeDialog()
      } else {
        setDialogOpen(true)
      }
    },
    [closeDialog],
  )

  const handleCreate = React.useCallback(
    async ({ base, custom, entityId: formEntityId }: ActivityFormSubmitPayload) => {
      const submissionEntityId = resolveEntityForSubmission(formEntityId)
      if (!submissionEntityId) {
        const message = t('customers.people.detail.activities.entityMissing', 'Select a related customer before saving.')
        flash(message, 'error')
        throw new Error(message)
      }
      setPendingAction({ kind: 'create' })
      pushLoading()
      try {
        const payload: Record<string, unknown> = {
          entityId: submissionEntityId,
          activityType: base.activityType,
          subject: base.subject ?? undefined,
          body: base.body ?? undefined,
          occurredAt: base.occurredAt ?? undefined,
        }
        if (base.dealId) payload.dealId = base.dealId
        if (Object.keys(custom).length) payload.customFields = custom
        await createCrud('customers/activities', payload, {
          errorMessage: t('customers.people.detail.activities.error', 'Failed to save activity'),
        })
        await loadActivities()
        flash(t('customers.people.detail.activities.success', 'Activity saved'), 'success')
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : t('customers.people.detail.activities.error', 'Failed to save activity')
        throw err instanceof Error ? err : new Error(message)
      } finally {
        setPendingAction(null)
        popLoading()
      }
    },
    [loadActivities, popLoading, pushLoading, resolveEntityForSubmission, t],
  )

  const handleUpdate = React.useCallback(
    async (activityId: string, { base, custom, entityId: formEntityId }: ActivityFormSubmitPayload) => {
      const submissionEntityId = resolveEntityForSubmission(formEntityId)
      if (!submissionEntityId) {
        const message = t('customers.people.detail.activities.entityMissing', 'Select a related customer before saving.')
        flash(message, 'error')
        throw new Error(message)
      }
      setPendingAction({ kind: 'update', id: activityId })
      pushLoading()
      try {
        await updateCrud(
          'customers/activities',
          {
            id: activityId,
            entityId: submissionEntityId,
            activityType: base.activityType,
            subject: base.subject ?? undefined,
            body: base.body ?? undefined,
            occurredAt: base.occurredAt ?? undefined,
            dealId: base.dealId ?? undefined,
            ...(Object.keys(custom).length ? { customFields: custom } : {}),
          },
          { errorMessage: t('customers.people.detail.activities.error', 'Failed to save activity') },
        )
        await loadActivities()
        flash(t('customers.people.detail.activities.updateSuccess', 'Activity updated.'), 'success')
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : t('customers.people.detail.activities.error', 'Failed to save activity')
        throw err instanceof Error ? err : new Error(message)
      } finally {
        setPendingAction(null)
        popLoading()
      }
    },
    [loadActivities, popLoading, pushLoading, resolveEntityForSubmission, t],
  )

  const handleDelete = React.useCallback(
    async (activity: ActivitySummary) => {
      if (!activity.id) return
      const confirmed =
        typeof window === 'undefined'
          ? true
          : window.confirm(
            t(
              'customers.people.detail.activities.deleteConfirm',
              'Delete this activity? This action cannot be undone.',
            ),
          )
      if (!confirmed) return
      setPendingAction({ kind: 'delete', id: activity.id })
      try {
        await deleteCrud('customers/activities', {
          id: activity.id,
          errorMessage: t('customers.people.detail.activities.deleteError', 'Failed to delete activity.'),
        })
        setActivities((prev) => prev.filter((existing) => existing.id !== activity.id))
        flash(t('customers.people.detail.activities.deleteSuccess', 'Activity deleted.'), 'success')
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : t('customers.people.detail.activities.deleteError', 'Failed to delete activity.')
        flash(message, 'error')
        throw err instanceof Error ? err : new Error(message)
      } finally {
        setPendingAction(null)
      }
    },
    [t],
  )

  const handleDialogSubmit = React.useCallback(
    async (payload: ActivityFormSubmitPayload) => {
      if (dialogMode === 'edit' && editingActivityId) {
        await handleUpdate(editingActivityId, payload)
      } else {
        await handleCreate(payload)
      }
      closeDialog()
    },
    [closeDialog, dialogMode, editingActivityId, handleCreate, handleUpdate],
  )

  React.useEffect(() => {
    if (!onActionChange) return
    const disabled = resolveEntityForSubmission(null) === null || pendingAction !== null || isLoading
    const action: SectionAction = {
      label: addActionLabel,
      onClick: () => {
        if (!disabled) openCreateDialog()
      },
      disabled,
    }
    onActionChange(action)
    return () => {
      onActionChange(null)
    }
  }, [addActionLabel, isLoading, onActionChange, openCreateDialog, pendingAction, resolveEntityForSubmission])

  const isFormPending =
    pendingAction?.kind === 'create' ||
    (pendingAction?.kind === 'update' && pendingAction.id === editingActivityId)
  const visibleActivities = React.useMemo(
    () => activities.slice(0, visibleCount),
    [activities, visibleCount],
  )
  const hasMoreActivities = visibleCount < activities.length
  const loadMoreLabel = t('customers.people.detail.activities.loadMore', 'Load more activities')

  const handleLoadMore = React.useCallback(() => {
    setVisibleCount((prev) => {
      if (prev >= activities.length) return prev
      return Math.min(prev + 5, activities.length)
    })
  }, [activities.length])

  return (
    <div className="mt-3 space-y-4">
      {loadError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {loadError}
        </div>
      ) : null}
      <div className="space-y-4">
        {isLoading && activities.length === 0 ? (
          <LoadingMessage
            label={t('customers.people.detail.activities.loading', 'Loading activities…')}
            className="border-0 bg-transparent p-0 py-8"
          />
        ) : (
          <>
            {!isLoading && activities.length === 0 ? (
              <EmptyState
                title={emptyState.title}
                action={{
                  label: emptyState.actionLabel,
                  onClick: openCreateDialog,
                  disabled: resolveEntityForSubmission(null) === null || pendingAction !== null,
                }}
              />
            ) : null}
            {visibleActivities.length > 0
              ? visibleActivities.map((activity) => {
                  const entry = dictionaryMap[activity.activityType]
                  const displayIcon = entry?.icon ?? activity.appearanceIcon ?? null
                  const displayColor = entry?.color ?? activity.appearanceColor ?? null
                  const displayLabel = entry?.label ?? activity.activityType
                  const timestampValue = activity.occurredAt ?? activity.createdAt ?? null
                  const occurredLabel =
                    formatDateTime(timestampValue) ?? t('customers.people.detail.activities.noDate', 'No date provided')
                  const authorLabel = activity.authorName ?? activity.authorEmail ?? null
                  const loggedByText = authorLabel
                    ? (() => {
                        const translated = t('customers.people.detail.activities.loggedBy', undefined, { user: authorLabel })
                        if (
                          !translated ||
                          translated === 'customers.people.detail.activities.loggedBy' ||
                          translated.includes('{{') ||
                          translated.includes('{user')
                        ) {
                          return `Logged by ${authorLabel}`
                        }
                        return translated
                      })()
                    : null
                  const isUpdatePending = pendingAction?.kind === 'update' && pendingAction.id === activity.id
                  const isDeletePending = pendingAction?.kind === 'delete' && pendingAction.id === activity.id
                  const customEntries = Array.isArray(activity.customFields) ? activity.customFields : []

                  return (
                    <div
                      key={activity.id}
                      className="group space-y-3 rounded-lg border bg-card p-4 transition hover:border-border/80 cursor-pointer"
                      role="button"
                      tabIndex={0}
                      onClick={() => openEditDialog(activity)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          openEditDialog(activity)
                        }
                      }}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                          <TimelineItemHeader
                            title={displayLabel}
                            timestamp={timestampValue}
                            fallbackTimestampLabel={occurredLabel}
                            icon={displayIcon}
                            color={displayColor}
                          />
                          {activity.dealId ? (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <ArrowUpRightSquare className="h-3.5 w-3.5" />
                              <Link
                                href={`/backend/customers/deals/${encodeURIComponent(activity.dealId)}`}
                                className="font-medium text-foreground hover:underline"
                                onClick={(event) => event.stopPropagation()}
                              >
                                {activity.dealTitle && activity.dealTitle.length
                                  ? activity.dealTitle
                                  : t('customers.people.detail.activities.linkedDeal', 'Linked deal')}
                              </Link>
                            </div>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={(event) => {
                              event.stopPropagation()
                              openEditDialog(activity)
                            }}
                            disabled={pendingAction !== null}
                          >
                            {isUpdatePending ? (
                              <span className="relative flex h-4 w-4 items-center justify-center">
                                <span className="absolute h-4 w-4 animate-spin rounded-full border border-primary border-t-transparent" />
                              </span>
                            ) : (
                              <Pencil className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={(event) => {
                              event.stopPropagation()
                              handleDelete(activity).catch(() => {})
                            }}
                            disabled={pendingAction !== null}
                          >
                            {isDeletePending ? (
                              <span className="relative flex h-4 w-4 items-center justify-center text-destructive">
                                <span className="absolute h-4 w-4 animate-spin rounded-full border border-destructive border-t-transparent" />
                              </span>
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>
                      {activity.subject ? <p className="text-sm font-medium">{activity.subject}</p> : null}
                      {activity.body ? (
                        <p className="text-sm whitespace-pre-wrap text-muted-foreground">{activity.body}</p>
                      ) : null}
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
                      {loggedByText ? (
                        <p className="text-xs text-muted-foreground">{loggedByText}</p>
                      ) : null}
                    </div>
                  )
                })
              : null}
            {hasMoreActivities ? (
              <div className="flex justify-center">
                <Button variant="outline" size="sm" onClick={handleLoadMore} disabled={pendingAction !== null}>
                  {loadMoreLabel}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>

      <ActivityDialog
        open={dialogOpen}
        mode={dialogMode}
        onOpenChange={handleDialogOpenChange}
        initialValues={initialValues}
        onSubmit={async (payload) => {
          await handleDialogSubmit(payload)
        }}
        isSubmitting={Boolean(isFormPending)}
        activityTypeLabels={activityTypeLabels}
        loadActivityOptions={loadDictionaryOptions}
        createActivityOption={createDictionaryOption}
        dealOptions={dealOptions}
        entityOptions={entityOptions}
        defaultEntityId={resolvedDefaultEntityId || undefined}
      />
    </div>
  )
}
