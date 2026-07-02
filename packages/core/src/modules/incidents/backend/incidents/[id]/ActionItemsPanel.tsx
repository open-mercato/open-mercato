"use client"

import * as React from 'react'
import { CheckCircle2, ClipboardList, Plus, Trash2 } from 'lucide-react'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { UserSelect } from '../components/UserSelect'
import { useUserLabels } from '../components/useUserLabels'

type ActionItemStatus = 'open' | 'in_progress' | 'done' | 'cancelled'

type ActionItem = {
  id: string
  incidentId: string
  title: string
  description: string | null
  assigneeUserId: string | null
  status: ActionItemStatus | string
  dueAt: string | null
  completedAt: string | null
  updatedAt?: string | null
}

type ActionItemsResponse = {
  items?: ActionItem[]
  total?: number
  error?: string
}

type ActionItemMutationResponse = {
  ok?: boolean
  actionItemId?: string | null
  updatedAt?: string | null
}

type ActionItemMutationContext = Record<string, unknown> & {
  formId: string
  resourceKind: 'incidents.incident'
  resourceId: string
  retryLastMutation: () => Promise<boolean>
}

type ActionItemsPanelProps = {
  incidentId: string
  updatedAt?: string | null
  canManage: boolean
  onChanged: () => void | Promise<void>
}

type AddActionItemForm = {
  title: string
  description: string
  assigneeUserId: string | null
  dueAt: string
}

const actionStatuses: readonly ActionItemStatus[] = ['open', 'in_progress', 'done', 'cancelled']

const emptyAddForm: AddActionItemForm = {
  title: '',
  description: '',
  assigneeUserId: null,
  dueAt: '',
}

function isActionItemStatus(value: string): value is ActionItemStatus {
  return actionStatuses.includes(value as ActionItemStatus)
}

function statusLabel(t: ReturnType<typeof useT>, status: string): string {
  if (status === 'open') return t('incidents.actionItems.status.open', 'Open')
  if (status === 'in_progress') return t('incidents.actionItems.status.inProgress', 'In progress')
  if (status === 'done') return t('incidents.actionItems.status.done', 'Done')
  if (status === 'cancelled') return t('incidents.actionItems.status.cancelled', 'Cancelled')
  return status
}

function statusVariant(status: string): StatusBadgeVariant {
  if (status === 'done') return 'success'
  if (status === 'in_progress') return 'info'
  if (status === 'cancelled') return 'neutral'
  return 'warning'
}

function formatDate(value: string | null | undefined, t: ReturnType<typeof useT>): string {
  if (!value) return t('incidents.common.notSet')
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return t('incidents.common.notSet')
  return date.toLocaleDateString()
}

function isOverdue(item: ActionItem): boolean {
  if (!item.dueAt || item.status === 'done' || item.status === 'cancelled') return false
  const due = new Date(item.dueAt)
  return !Number.isNaN(due.getTime()) && due.getTime() < Date.now()
}

function readPayloadString(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== 'object') return null
  const value = (payload as Record<string, unknown>)[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function errorMessage(result: ActionItemsResponse | null, fallback: string): string {
  return typeof result?.error === 'string' && result.error.trim().length > 0 ? result.error : fallback
}

function userLabel(
  value: string | null | undefined,
  labels: Record<string, string>,
  t: ReturnType<typeof useT>,
): string {
  const id = value?.trim()
  if (!id) return t('incidents.actionItems.assignee.unassigned', 'Unassigned')
  return labels[id] ?? id
}

export function ActionItemsPanel({ incidentId, updatedAt, canManage, onChanged }: ActionItemsPanelProps) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [items, setItems] = React.useState<ActionItem[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [currentUpdatedAt, setCurrentUpdatedAt] = React.useState<string | null>(updatedAt ?? null)
  const [pendingId, setPendingId] = React.useState<string | null>(null)
  const [addDialogOpen, setAddDialogOpen] = React.useState(false)
  const [addForm, setAddForm] = React.useState<AddActionItemForm>(emptyAddForm)
  const [titleError, setTitleError] = React.useState<string | null>(null)
  const contextId = React.useMemo(() => `incident-action-items:${incidentId}`, [incidentId])
  const { runMutation, retryLastMutation } = useGuardedMutation<ActionItemMutationContext>({
    contextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })
  const mutationContext = React.useMemo<ActionItemMutationContext>(() => ({
    formId: contextId,
    resourceKind: 'incidents.incident',
    resourceId: incidentId,
    retryLastMutation,
  }), [contextId, incidentId, retryLastMutation])
  const assigneeUserIds = React.useMemo(() => (
    items
      .map((item) => item.assigneeUserId)
      .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
  ), [items])
  const userLabels = useUserLabels(assigneeUserIds)

  React.useEffect(() => {
    setCurrentUpdatedAt(updatedAt ?? null)
  }, [updatedAt])

  const loadItems = React.useCallback(async () => {
    setIsLoading(true)
    setError(null)
    const itemsResult = await apiCall<ActionItemsResponse>(`/api/incidents/${encodeURIComponent(incidentId)}/action-items`)
    if (!itemsResult.ok) {
      throw new Error(errorMessage(itemsResult.result, t('incidents.actionItems.error.load', 'Failed to load action items.')))
    }
    const nextItems = Array.isArray(itemsResult.result?.items) ? itemsResult.result.items : []
    setItems(nextItems)
    setIsLoading(false)
  }, [incidentId, t])

  React.useEffect(() => {
    let active = true
    loadItems().catch((err) => {
      if (!active) return
      setError(err instanceof Error ? err.message : t('incidents.actionItems.error.load', 'Failed to load action items.'))
      setIsLoading(false)
    })
    return () => {
      active = false
    }
  }, [loadItems, t])

  useAppEvent('incidents.action_item.*', (event) => {
    const eventIncidentId = readPayloadString(event.payload, 'incidentId')
    if (!eventIncidentId || eventIncidentId === incidentId) void loadItems()
  }, [incidentId, loadItems])

  useAppEvent('incidents.timeline_entry.added', (event) => {
    const eventIncidentId = readPayloadString(event.payload, 'incidentId')
    if (!eventIncidentId || eventIncidentId === incidentId) void loadItems()
  }, [incidentId, loadItems])

  const refreshAfterConflict = React.useCallback(() => {
    void loadItems()
    void onChanged()
  }, [loadItems, onChanged])

  const handleMutationSuccess = React.useCallback(async (
    response: ActionItemMutationResponse | null | undefined,
    message: string,
  ) => {
    const freshUpdatedAt = response?.updatedAt
    if (typeof freshUpdatedAt === 'string' && freshUpdatedAt.length > 0) {
      setCurrentUpdatedAt(freshUpdatedAt)
    }
    flash(message, 'success')
    await loadItems()
    await onChanged()
  }, [loadItems, onChanged])

  const handleMutationError = React.useCallback((err: unknown, fallback: string) => {
    if (!surfaceRecordConflict(err, t, { onRefresh: refreshAfterConflict })) {
      flash(fallback, 'error')
    }
  }, [refreshAfterConflict, t])

  const handleStatusChange = React.useCallback(async (item: ActionItem, value: string) => {
    if (!canManage || pendingId || !isActionItemStatus(value) || value === item.status) return
    setPendingId(item.id)
    try {
      const call = await runMutation({
        operation: async () => apiCallOrThrow<ActionItemMutationResponse>(
          `/api/incidents/${encodeURIComponent(incidentId)}/action-items/${encodeURIComponent(item.id)}`,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              ...buildOptimisticLockHeader(currentUpdatedAt),
            },
            body: JSON.stringify({ status: value }),
          },
          { errorMessage: t('incidents.actionItems.error.update', 'Failed to update the action item.') },
        ),
        context: mutationContext,
        mutationPayload: { incidentId, actionItemId: item.id, status: value },
      })
      await handleMutationSuccess(call.result, t('incidents.actionItems.success.update', 'Action item updated.'))
    } catch (err) {
      handleMutationError(err, t('incidents.actionItems.error.update', 'Failed to update the action item.'))
    } finally {
      setPendingId(null)
    }
  }, [
    canManage,
    currentUpdatedAt,
    handleMutationError,
    handleMutationSuccess,
    incidentId,
    mutationContext,
    pendingId,
    runMutation,
    t,
  ])

  const handleDelete = React.useCallback(async (item: ActionItem) => {
    if (!canManage || pendingId) return
    const approved = await confirm({
      title: t('incidents.actionItems.delete.title', 'Delete action item?'),
      description: t('incidents.actionItems.delete.description', 'This action item will be removed from the incident.'),
      confirmText: t('incidents.actionItems.actions.delete', 'Delete'),
      cancelText: t('incidents.common.cancel'),
      variant: 'destructive',
    })
    if (!approved) return

    setPendingId(item.id)
    try {
      const call = await runMutation({
        operation: async () => apiCallOrThrow<ActionItemMutationResponse>(
          `/api/incidents/${encodeURIComponent(incidentId)}/action-items/${encodeURIComponent(item.id)}`,
          {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
              ...buildOptimisticLockHeader(currentUpdatedAt),
            },
            body: '{}',
          },
          { errorMessage: t('incidents.actionItems.error.delete', 'Failed to delete the action item.') },
        ),
        context: mutationContext,
        mutationPayload: { incidentId, actionItemId: item.id, operation: 'deleteActionItem' },
      })
      await handleMutationSuccess(call.result, t('incidents.actionItems.success.delete', 'Action item deleted.'))
    } catch (err) {
      handleMutationError(err, t('incidents.actionItems.error.delete', 'Failed to delete the action item.'))
    } finally {
      setPendingId(null)
    }
  }, [
    canManage,
    confirm,
    currentUpdatedAt,
    handleMutationError,
    handleMutationSuccess,
    incidentId,
    mutationContext,
    pendingId,
    runMutation,
    t,
  ])

  const handleAddSubmit = React.useCallback(async () => {
    const title = addForm.title.trim()
    if (!title) {
      setTitleError(t('incidents.actionItems.validation.titleRequired', 'Title is required.'))
      return
    }
    if (!canManage || pendingId) return
    setTitleError(null)
    setPendingId('new')
    const payload: {
      title: string
      description?: string
      assigneeUserId?: string | null
      dueAt?: string
    } = { title }
    const description = addForm.description.trim()
    if (description) payload.description = description
    if (addForm.assigneeUserId) payload.assigneeUserId = addForm.assigneeUserId
    if (addForm.dueAt) payload.dueAt = addForm.dueAt

    try {
      const call = await runMutation({
        operation: async () => apiCallOrThrow<ActionItemMutationResponse>(
          `/api/incidents/${encodeURIComponent(incidentId)}/action-items`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...buildOptimisticLockHeader(currentUpdatedAt),
            },
            body: JSON.stringify(payload),
          },
          { errorMessage: t('incidents.actionItems.error.create', 'Failed to create the action item.') },
        ),
        context: mutationContext,
        mutationPayload: { incidentId, ...payload },
      })
      setAddForm(emptyAddForm)
      setAddDialogOpen(false)
      await handleMutationSuccess(call.result, t('incidents.actionItems.success.create', 'Action item created.'))
    } catch (err) {
      handleMutationError(err, t('incidents.actionItems.error.create', 'Failed to create the action item.'))
    } finally {
      setPendingId(null)
    }
  }, [
    addForm.assigneeUserId,
    addForm.description,
    addForm.dueAt,
    addForm.title,
    canManage,
    currentUpdatedAt,
    handleMutationError,
    handleMutationSuccess,
    incidentId,
    mutationContext,
    pendingId,
    runMutation,
    t,
  ])

  const handleDialogKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void handleAddSubmit()
    }
    if (event.key === 'Escape' && pendingId !== 'new') {
      setAddDialogOpen(false)
    }
  }, [handleAddSubmit, pendingId])

  const openAddDialog = React.useCallback(() => {
    setAddForm(emptyAddForm)
    setTitleError(null)
    setAddDialogOpen(true)
  }, [])

  if (isLoading) {
    return (
      <section className="rounded-lg border border-border bg-card p-4">
        <SectionHeader title={t('incidents.actionItems.title', 'Action items')} />
        <div className="mt-4 flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Spinner size="sm" />
          <span>{t('incidents.actionItems.loading', 'Loading action items')}</span>
        </div>
      </section>
    )
  }

  if (error) {
    return (
      <section className="rounded-lg border border-border bg-card p-4">
        <SectionHeader title={t('incidents.actionItems.title', 'Action items')} />
        <div className="mt-4">
          <ErrorMessage label={error} />
        </div>
      </section>
    )
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <SectionHeader
        title={t('incidents.actionItems.title', 'Action items')}
        count={items.length}
        action={canManage ? (
          <Button type="button" size="sm" onClick={openAddDialog} disabled={pendingId !== null}>
            <Plus className="size-4" aria-hidden="true" />
            {t('incidents.actionItems.actions.add', 'Add')}
          </Button>
        ) : undefined}
      />

      <div className="mt-4">
        {items.length > 0 ? (
          <ul className="space-y-3">
            {items.map((item) => {
              const overdue = isOverdue(item)
              const done = item.status === 'done'
              const assigneeLabel = userLabel(item.assigneeUserId, userLabels, t)
              return (
                <li key={item.id} className="rounded-md border border-border bg-background p-3">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-foreground">{item.title}</p>
                        <StatusBadge variant={statusVariant(item.status)} dot>
                          {statusLabel(t, item.status)}
                        </StatusBadge>
                        {done && item.completedAt ? (
                          <StatusBadge variant="success">
                            {t('incidents.actionItems.completedAt', 'Completed {date}', {
                              date: formatDate(item.completedAt, t),
                            })}
                          </StatusBadge>
                        ) : null}
                      </div>
                      {item.description?.trim() ? (
                        <p className="whitespace-pre-wrap text-sm text-muted-foreground">{item.description}</p>
                      ) : null}
                      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                        <span className="inline-flex items-center gap-2">
                          <Avatar
                            label={assigneeLabel}
                            size="sm"
                            variant="monochrome"
                            ariaLabel={t('incidents.actionItems.assignee.avatarLabel', 'Assignee {id}', {
                              id: assigneeLabel,
                            })}
                          />
                          <span>{assigneeLabel}</span>
                        </span>
                        {item.dueAt ? (
                          overdue ? (
                            <StatusBadge variant="error">
                              {t('incidents.actionItems.due.overdue', 'Overdue {date}', {
                                date: formatDate(item.dueAt, t),
                              })}
                            </StatusBadge>
                          ) : (
                            <span>
                              {t('incidents.actionItems.due.label', 'Due {date}', {
                                date: formatDate(item.dueAt, t),
                              })}
                            </span>
                          )
                        ) : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {canManage ? (
                        <Select
                          value={isActionItemStatus(item.status) ? item.status : 'open'}
                          onValueChange={(value) => void handleStatusChange(item, value)}
                          disabled={pendingId !== null}
                        >
                          <SelectTrigger className="w-40" aria-label={t('incidents.actionItems.actions.changeStatus', 'Change status')}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {actionStatuses.map((status) => (
                              <SelectItem key={status} value={status}>
                                {statusLabel(t, status)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : null}
                      {canManage ? (
                        <IconButton
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={t('incidents.actionItems.actions.deleteAria', 'Delete action item')}
                          disabled={pendingId !== null}
                          onClick={() => void handleDelete(item)}
                        >
                          <Trash2 aria-hidden="true" />
                        </IconButton>
                      ) : null}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        ) : (
          <EmptyState
            variant="subtle"
            icon={<ClipboardList className="size-6" aria-hidden="true" />}
            title={t('incidents.actionItems.empty.title', 'No action items yet')}
            description={t('incidents.actionItems.empty.description', 'Track follow-up work from the incident here.')}
            actions={canManage ? (
              <Button type="button" variant="outline" onClick={openAddDialog} disabled={pendingId !== null}>
                <Plus className="size-4" aria-hidden="true" />
                {t('incidents.actionItems.actions.add', 'Add')}
              </Button>
            ) : undefined}
          />
        )}
      </div>

      <Dialog open={addDialogOpen} onOpenChange={(open) => {
        if (!open && pendingId !== 'new') setAddDialogOpen(false)
      }}>
        <DialogContent className="sm:max-w-lg" onKeyDown={handleDialogKeyDown}>
          <DialogHeader>
            <DialogTitle>{t('incidents.actionItems.addDialog.title', 'Add action item')}</DialogTitle>
            <DialogDescription>
              {t('incidents.actionItems.addDialog.description', 'Create follow-up work for this incident.')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="incident-action-title">{t('incidents.actionItems.fields.title', 'Title')}</Label>
              <Input
                id="incident-action-title"
                value={addForm.title}
                onChange={(event) => {
                  setTitleError(null)
                  setAddForm((prev) => ({ ...prev, title: event.currentTarget.value }))
                }}
                aria-invalid={titleError ? true : undefined}
                disabled={pendingId === 'new'}
              />
              {titleError ? <p className="text-sm text-destructive">{titleError}</p> : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="incident-action-description">{t('incidents.actionItems.fields.description', 'Description')}</Label>
              <Textarea
                id="incident-action-description"
                value={addForm.description}
                onChange={(event) => setAddForm((prev) => ({ ...prev, description: event.currentTarget.value }))}
                disabled={pendingId === 'new'}
                rows={4}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="incident-action-assignee">{t('incidents.actionItems.fields.assignee', 'Assignee')}</Label>
              <UserSelect
                id="incident-action-assignee"
                value={addForm.assigneeUserId}
                onChange={(value) => setAddForm((prev) => ({ ...prev, assigneeUserId: value }))}
                disabled={pendingId === 'new'}
                nullable
                placeholder={t('incidents.actionItems.assignee.placeholder', 'Select assignee')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="incident-action-due">{t('incidents.actionItems.fields.dueAt', 'Due date')}</Label>
              <Input
                id="incident-action-due"
                type="date"
                value={addForm.dueAt}
                onChange={(event) => setAddForm((prev) => ({ ...prev, dueAt: event.currentTarget.value }))}
                disabled={pendingId === 'new'}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAddDialogOpen(false)}
              disabled={pendingId === 'new'}
            >
              {t('incidents.common.cancel')}
            </Button>
            <Button type="button" onClick={() => void handleAddSubmit()} disabled={pendingId === 'new'}>
              <CheckCircle2 className="size-4" aria-hidden="true" />
              {t('incidents.actionItems.actions.create', 'Create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {ConfirmDialogElement}
    </section>
  )
}
