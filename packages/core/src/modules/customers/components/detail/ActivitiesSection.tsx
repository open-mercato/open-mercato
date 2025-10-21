"use client"

import * as React from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { formatDateTime, formatRelativeTime } from './utils'
import { ActivityForm, type ActivityFormBaseValues, type ActivityFormSubmitPayload } from './ActivityForm'
import type { DictionarySelectLabels } from '@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect'
import { renderDictionaryColor, renderDictionaryIcon } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import type { CustomerDictionaryMap } from '../../../../lib/dictionaries'
import { useT } from '@/lib/i18n/context'

type ActivitySummary = {
  id: string
  activityType: string
  subject?: string | null
  body?: string | null
  occurredAt?: string | null
  createdAt: string
  appearanceIcon?: string | null
  appearanceColor?: string | null
  authorUserId?: string | null
  authorName?: string | null
  authorEmail?: string | null
}

type SectionAction = {
  label: string
  onClick: () => void
  disabled?: boolean
}

type TabEmptyState = {
  title: string
  actionLabel: string
}

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
  loadDictionaryOptions: () => Promise<DictionaryOption[]>
  createDictionaryOption?: (input: { value: string; label?: string; color?: string | null; icon?: string | null }) => Promise<DictionaryOption>
  dictionaryLabels: DictionarySelectLabels
  dictionaryMap: CustomerDictionaryMap
  onDictionaryChange?: () => void
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
  loadDictionaryOptions,
  createDictionaryOption,
  dictionaryLabels,
  dictionaryMap,
  onDictionaryChange,
  onActionChange,
  pendingActivityId,
  pendingActivityAction,
}: ActivitiesSectionProps) {
  const t = useT()
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [dialogMode, setDialogMode] = React.useState<'create' | 'edit'>('create')
  const [editingActivityId, setEditingActivityId] = React.useState<string | null>(null)
  const [initialValues, setInitialValues] = React.useState<ActivityFormBaseValues | undefined>(undefined)

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
      if (onDictionaryChange) onDictionaryChange()
    },
    [closeDialog, dialogMode, editingActivityId, onCreate, onDictionaryChange, onUpdate],
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
      if (onDictionaryChange) onDictionaryChange()
    },
    [onDelete, onDictionaryChange, t],
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
            activityTypeLabels={dictionaryLabels}
            loadActivityOptions={loadDictionaryOptions}
            createActivityOption={createDictionaryOption}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
