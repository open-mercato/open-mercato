"use client"

import * as React from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { formatDateTime, formatRelativeTime, createDictionarySelectLabels } from './utils'
import { ActivityForm, type ActivityFormBaseValues, type ActivityFormSubmitPayload } from './ActivityForm'
import { renderDictionaryColor, renderDictionaryIcon } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import { useT } from '@/lib/i18n/context'
import { useQueryClient } from '@tanstack/react-query'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import type { ActivitySummary, SectionAction, TabEmptyState } from './types'
import {
  ensureCustomerDictionary,
  invalidateCustomerDictionary,
  useCustomerDictionary,
} from './hooks/useCustomerDictionary'

type DictionaryOption = {
  value: string
  label: string
  color: string | null
  icon: string | null
}

export type ActivitiesSectionProps = {
  activities: ActivitySummary[]
  onCreate: (payload: ActivityFormSubmitPayload) => Promise<void>
  onUpdate: (activityId: string, payload: ActivityFormSubmitPayload) => Promise<void>
  onDelete: (activityId: string) => Promise<void>
  isSubmitting: boolean
  addActionLabel: string
  emptyState: TabEmptyState
  onActionChange?: (action: SectionAction | null) => void
  pendingActivityId: string | null
  pendingActivityAction: 'create' | 'update' | 'delete' | null
}

export function ActivitiesSection({
  activities,
  onCreate,
  onUpdate,
  onDelete,
  isSubmitting,
  addActionLabel,
  emptyState,
  onActionChange,
  pendingActivityId,
  pendingActivityAction,
}: ActivitiesSectionProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const dictionaryQuery = useCustomerDictionary('activity-types', scopeVersion)
  const dictionaryMap = dictionaryQuery.data?.map ?? {}
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [dialogMode, setDialogMode] = React.useState<'create' | 'edit'>('create')
  const [editingActivityId, setEditingActivityId] = React.useState<string | null>(null)
  const [initialValues, setInitialValues] = React.useState<ActivityFormBaseValues | undefined>(undefined)

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
          label: input.label,
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
          ? payload.value
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

  const isCreatePending = pendingActivityAction === 'create'
  const isUpdatePending =
    pendingActivityAction === 'update' && editingActivityId !== null && pendingActivityId === editingActivityId

  const openCreateDialog = React.useCallback(() => {
    setDialogMode('create')
    setEditingActivityId(null)
    setInitialValues(undefined)
    setDialogOpen(true)
  }, [])

  const openEditDialog = React.useCallback((activity: ActivitySummary) => {
    setDialogMode('edit')
    setEditingActivityId(activity.id)
    setInitialValues({
      activityType: activity.activityType,
      subject: activity.subject ?? '',
      body: activity.body ?? '',
      occurredAt: activity.occurredAt ?? activity.createdAt ?? null,
    })
    setDialogOpen(true)
  }, [])

  const closeDialog = React.useCallback(() => {
    setDialogOpen(false)
    setDialogMode('create')
    setEditingActivityId(null)
    setInitialValues(undefined)
  }, [])

  React.useEffect(() => {
    if (!onActionChange) return
    onActionChange({
      label: addActionLabel,
      onClick: openCreateDialog,
      disabled: isSubmitting || isCreatePending,
    })
    return () => onActionChange(null)
  }, [addActionLabel, isSubmitting, isCreatePending, onActionChange, openCreateDialog])

  const handleSubmit = React.useCallback(
    async (payload: ActivityFormSubmitPayload) => {
      if (dialogMode === 'edit' && editingActivityId) {
        await onUpdate(editingActivityId, payload)
      } else {
        await onCreate(payload)
      }
      closeDialog()
    },
    [closeDialog, dialogMode, editingActivityId, onCreate, onUpdate],
  )

  const handleDelete = React.useCallback(
    async (activity: ActivitySummary) => {
      const confirmed =
        typeof window === 'undefined'
          ? true
          : window.confirm(
            t('customers.people.detail.activities.deleteConfirm', 'Delete this activity? This action cannot be undone.'),
          )
      if (!confirmed) return
      await onDelete(activity.id)
    },
    [onDelete, t],
  )

  const dialogTitle =
    dialogMode === 'edit'
      ? t('customers.people.detail.activities.editTitle', 'Edit activity')
      : t('customers.people.detail.activities.addTitle', 'Add activity')

  return (
    <div className="mt-4 space-y-6">
      <div className="space-y-4">
        {activities.length === 0 ? (
          <EmptyState
            title={emptyState.title}
            action={{
              label: emptyState.actionLabel,
              onClick: openCreateDialog,
              disabled: isSubmitting,
            }}
          />
        ) : (
          activities.map((activity) => {
            const entry = dictionaryMap[activity.activityType]
            const displayIcon = entry?.icon ?? activity.appearanceIcon ?? null
            const displayColor = entry?.color ?? activity.appearanceColor ?? null
            const displayLabel = entry?.label ?? activity.activityType
            const occurredLabel =
              formatDateTime(activity.occurredAt) ??
              formatDateTime(activity.createdAt) ??
              t('customers.people.detail.activities.noDate', 'No date provided')
            const relativeLabel = formatRelativeTime(activity.occurredAt ?? activity.createdAt ?? null)
            const authorLabel = activity.authorName ?? activity.authorEmail ?? null
            const isPending =
              pendingActivityAction !== 'create' && pendingActivityId === activity.id && pendingActivityAction !== null

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
                  <div className="flex items-start gap-3">
                    {displayIcon ? (
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded border border-border bg-muted/40">
                        {renderDictionaryIcon(displayIcon, 'h-4 w-4')}
                      </span>
                    ) : null}
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{displayLabel}</span>
                        {displayColor ? renderDictionaryColor(displayColor, 'h-3 w-3 rounded-full border border-border') : null}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        <span>{occurredLabel}</span>
                        {relativeLabel ? <span className="ml-1">({relativeLabel})</span> : null}
                      </div>
                    </div>
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
                      disabled={isSubmitting || isPending}
                    >
                      {pendingActivityAction === 'update' && isPending ? (
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
                        handleDelete(activity)
                      }}
                      disabled={isSubmitting || isPending}
                    >
                      {pendingActivityAction === 'delete' && isPending ? (
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
                {activity.body ? <p className="text-sm whitespace-pre-wrap text-muted-foreground">{activity.body}</p> : null}
                {authorLabel ? (
                  <p className="text-xs text-muted-foreground">
                    {t('customers.people.detail.activities.loggedBy', 'Logged by {{user}}', { user: authorLabel })}
                  </p>
                ) : null}
              </div>
            )
          })
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={(next) => { if (!next) closeDialog() }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
          </DialogHeader>
          <ActivityForm
            mode={dialogMode}
            initialValues={initialValues}
            onSubmit={handleSubmit}
            onCancel={closeDialog}
            submitLabel={
              dialogMode === 'edit'
                ? t('customers.people.detail.activities.update', 'Update activity')
                : t('customers.people.detail.activities.save', 'Save activity')
            }
            cancelLabel={t('customers.people.detail.activities.cancel', 'Cancel')}
            isSubmitting={isSubmitting || isCreatePending || isUpdatePending}
            activityTypeLabels={activityTypeLabels}
            loadActivityOptions={loadDictionaryOptions}
            createActivityOption={createDictionaryOption}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
