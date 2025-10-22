"use client"

import * as React from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { useQueryClient } from '@tanstack/react-query'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { useT } from '@/lib/i18n/context'
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
  addActionLabel: string
  emptyState: TabEmptyState
  onActionChange?: (action: SectionAction | null) => void
  onLoadingChange?: (isLoading: boolean) => void
}

function isEmptyCustomValue(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0 || value.every((entry) => isEmptyCustomValue(entry))
  return false
}

function stringifyCustomValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => stringifyCustomValue(entry))
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
    return parts.join(', ')
  }
  if (value instanceof Date) {
    const iso = value.toISOString()
    return formatDateTime(iso) ?? iso
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed.length) return ''
    return formatDateTime(trimmed) ?? trimmed
  }
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value)
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const candidate =
      record.label ?? record.name ?? record.title ?? record.value ?? record.id ?? record.key ?? null
    if (typeof candidate === 'string' && candidate.trim().length) {
      return candidate.trim()
    }
    try {
      return JSON.stringify(value)
    } catch {
      return ''
    }
  }
  return ''
}

export function ActivitiesSection({
  entityId,
  addActionLabel,
  emptyState,
  onActionChange,
  onLoadingChange,
}: ActivitiesSectionProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const dictionaryQuery = useCustomerDictionary('activity-types', scopeVersion)
  const dictionaryMap = dictionaryQuery.data?.map ?? {}
  const [activities, setActivities] = React.useState<ActivitySummary[]>([])
  const [isLoading, setIsLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [pendingAction, setPendingAction] = React.useState<PendingAction | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [dialogMode, setDialogMode] = React.useState<'create' | 'edit'>('create')
  const [editingActivityId, setEditingActivityId] = React.useState<string | null>(null)
  const [initialValues, setInitialValues] = React.useState<Partial<ActivityFormBaseValues & Record<string, unknown>> | undefined>(undefined)
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
      const res = await apiFetch('/api/customers/dictionaries/activity-types', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          value: input.value,
          label: input.label ?? undefined,
          color: input.color ?? undefined,
          icon: input.icon ?? undefined,
        }),
      })
      const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) {
        const message =
          typeof payload.error === 'string'
            ? payload.error
            : translate('customers.people.form.dictionary.error', 'Failed to save option')
        throw new Error(message)
      }
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

  const loadActivities = React.useCallback(async () => {
    if (!entityId) {
      setActivities([])
      setLoadError(null)
      return
    }
    pushLoading()
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        entityId,
        pageSize: '50',
        sortField: 'occurredAt',
        sortDir: 'desc',
      })
      const res = await apiFetch(`/api/customers/activities?${params.toString()}`)
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        const message =
          typeof payload?.error === 'string'
            ? payload.error
            : t('customers.people.detail.activities.loadError', 'Failed to load activities.')
        throw new Error(message)
      }
      const items = Array.isArray(payload?.items) ? (payload.items as ActivitySummary[]) : []
      setActivities(items)
      setLoadError(null)
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
  }, [entityId, popLoading, pushLoading, t])

  React.useEffect(() => {
    if (!entityId) {
      setActivities([])
      setLoadError(null)
      setIsLoading(false)
      pendingCounterRef.current = 0
      onLoadingChange?.(false)
      return
    }
    loadActivities().catch(() => {})
  }, [entityId, loadActivities, onLoadingChange])

  const openCreateDialog = React.useCallback(() => {
    if (!entityId) return
    setDialogMode('create')
    setEditingActivityId(null)
    setInitialValues(undefined)
    setDialogOpen(true)
  }, [entityId])

  const openEditDialog = React.useCallback((activity: ActivitySummary) => {
    setDialogMode('edit')
    setEditingActivityId(activity.id)
    const baseValues: Partial<ActivityFormBaseValues & Record<string, unknown>> = {
      activityType: activity.activityType,
      subject: activity.subject ?? '',
      body: activity.body ?? '',
      occurredAt: activity.occurredAt ?? activity.createdAt ?? null,
    }
    const customEntries = Array.isArray(activity.customFields) ? activity.customFields : []
    customEntries.forEach((entry) => {
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
    async ({ base, custom }: ActivityFormSubmitPayload) => {
      if (!entityId) {
        throw new Error(t('customers.people.detail.activities.error', 'Failed to save activity'))
      }
      setPendingAction({ kind: 'create' })
      pushLoading()
      try {
        const payload: Record<string, unknown> = {
          entityId,
          activityType: base.activityType,
          subject: base.subject ?? undefined,
          body: base.body ?? undefined,
          occurredAt: base.occurredAt ?? undefined,
        }
        if (Object.keys(custom).length) payload.customFields = custom
        const res = await apiFetch('/api/customers/activities', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const responseBody = await res.json().catch(() => ({}))
        if (!res.ok) {
          const message =
            typeof responseBody?.error === 'string'
              ? responseBody.error
              : t('customers.people.detail.activities.error', 'Failed to save activity')
          throw new Error(message)
        }
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
    [entityId, loadActivities, popLoading, pushLoading, t],
  )

  const handleUpdate = React.useCallback(
    async (activityId: string, { base, custom }: ActivityFormSubmitPayload) => {
      if (!entityId) {
        throw new Error(t('customers.people.detail.activities.error', 'Failed to save activity'))
      }
      setPendingAction({ kind: 'update', id: activityId })
      pushLoading()
      try {
        const res = await apiFetch('/api/customers/activities', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id: activityId,
            entityId,
            activityType: base.activityType,
            subject: base.subject ?? undefined,
            body: base.body ?? undefined,
            occurredAt: base.occurredAt ?? undefined,
            ...(Object.keys(custom).length ? { customFields: custom } : {}),
          }),
        })
        const responseBody = await res.json().catch(() => ({}))
        if (!res.ok) {
          const message =
            typeof responseBody?.error === 'string'
              ? responseBody.error
              : t('customers.people.detail.activities.error', 'Failed to save activity')
          throw new Error(message)
        }
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
    [entityId, loadActivities, popLoading, pushLoading, t],
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
      pushLoading()
      try {
        const res = await apiFetch('/api/customers/activities', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: activity.id }),
        })
        const responseBody = await res.json().catch(() => ({}))
        if (!res.ok) {
          const message =
            typeof responseBody?.error === 'string'
              ? responseBody.error
              : t('customers.people.detail.activities.deleteError', 'Failed to delete activity.')
          throw new Error(message)
        }
        await loadActivities()
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
        popLoading()
      }
    },
    [loadActivities, popLoading, pushLoading, t],
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
    const disabled = !entityId || pendingAction !== null || isLoading
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
  }, [addActionLabel, entityId, isLoading, onActionChange, openCreateDialog, pendingAction])

  const isFormPending =
    pendingAction?.kind === 'create' ||
    (pendingAction?.kind === 'update' && pendingAction.id === editingActivityId)

  return (
    <div className="mt-3 space-y-4">
      {loadError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {loadError}
        </div>
      ) : null}
      <div className="space-y-4">
        {!isLoading && activities.length === 0 ? (
          <EmptyState
            title={emptyState.title}
            action={{
              label: emptyState.actionLabel,
              onClick: openCreateDialog,
              disabled: !entityId || pendingAction !== null,
            }}
          />
        ) : null}
        {activities.length > 0
          ? activities.map((activity) => {
              const entry = dictionaryMap[activity.activityType]
              const displayIcon = entry?.icon ?? activity.appearanceIcon ?? null
              const displayColor = entry?.color ?? activity.appearanceColor ?? null
              const displayLabel = entry?.label ?? activity.activityType
              const timestampValue = activity.occurredAt ?? activity.createdAt ?? null
              const occurredLabel =
                formatDateTime(timestampValue) ?? t('customers.people.detail.activities.noDate', 'No date provided')
              const authorLabel = activity.authorName ?? activity.authorEmail ?? null
              const isUpdatePending = pendingAction?.kind === 'update' && pendingAction.id === activity.id
              const isDeletePending = pendingAction?.kind === 'delete' && pendingAction.id === activity.id
              const customEntries = Array.isArray(activity.customFields)
                ? activity.customFields.filter((entry) => !isEmptyCustomValue(entry.value))
                : []

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
                    <TimelineItemHeader
                      title={displayLabel}
                      timestamp={timestampValue}
                      fallbackTimestampLabel={occurredLabel}
                      icon={displayIcon}
                      color={displayColor}
                    />
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
                  {customEntries.length ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {customEntries.map((entry) => {
                        const valueLabel = stringifyCustomValue(entry.value)
                        return (
                          <div key={`${activity.id}-${entry.key}`} className="rounded-md border border-border/60 bg-muted/10 px-3 py-2">
                            <div className="text-xs font-medium text-muted-foreground">{entry.label}</div>
                            <div className="text-sm text-foreground">{valueLabel.trim().length ? valueLabel : '—'}</div>
                          </div>
                        )
                      })}
                    </div>
                  ) : null}
                  {authorLabel ? (
                    <p className="text-xs text-muted-foreground">
                      {t('customers.people.detail.activities.loggedBy', 'Logged by {{user}}', { user: authorLabel })}
                    </p>
                  ) : null}
                </div>
              )
            })
          : null}
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
      />
    </div>
  )
}
