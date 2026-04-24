'use client'

import * as React from 'react'
import { Users, Phone, Check, Mail, Calendar, AlertTriangle, X } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Dialog, DialogContent, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { SwitchableMarkdownInput } from '@open-mercato/ui/backend/inputs'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import {
  useScheduleFormState,
  FIELD_VISIBILITY,
  getFieldLabel,
  DateTimeFields,
  ParticipantsField,
  LocationField,
  FooterFields,
  LinkedEntitiesField,
} from './schedule'
import type { ActivityType, ScheduleActivityEditData } from './schedule'

const TYPE_TABS: Array<{ type: ActivityType; icon: React.ComponentType<{ className?: string }>; labelKey: string; fallback: string }> = [
  { type: 'meeting', icon: Users, labelKey: 'customers.schedule.types.meeting', fallback: 'Meeting' },
  { type: 'call', icon: Phone, labelKey: 'customers.schedule.types.call', fallback: 'Call' },
  { type: 'task', icon: Check, labelKey: 'customers.schedule.types.task', fallback: 'Task' },
  { type: 'email', icon: Mail, labelKey: 'customers.schedule.types.email', fallback: 'Email' },
]

interface ScheduleActivityDialogProps {
  open: boolean
  onClose: () => void
  entityId: string
  dealId?: string | null
  entityName?: string
  companyName?: string | null
  entityType: 'company' | 'person' | 'deal'
  onActivityCreated?: () => void
  /** When provided, dialog opens in edit mode with pre-filled data */
  editData?: ScheduleActivityEditData | null
}

export function ScheduleActivityDialog({
  open,
  onClose,
  entityId,
  dealId = null,
  entityName,
  companyName,
  entityType,
  onActivityCreated,
  editData,
}: ScheduleActivityDialogProps) {
  const t = useT()
  const state = useScheduleFormState({ open, editData: editData ?? null })
  const visibleFields = FIELD_VISIBILITY[state.activityType]
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const formSnapshot = React.useMemo(() => JSON.stringify({
    activityType: state.activityType,
    title: state.title,
    date: state.date,
    startTime: state.startTime,
    duration: state.duration,
    allDay: state.allDay,
    description: state.description,
    location: state.location,
    reminderMinutes: state.reminderMinutes,
    visibility: state.visibility,
    participants: state.participants,
    linkedEntities: state.linkedEntities,
    recurrenceEnabled: state.recurrenceEnabled,
    recurrenceDays: state.recurrenceDays,
    recurrenceEndType: state.recurrenceEndType,
    recurrenceCount: state.recurrenceCount,
    recurrenceEndDate: state.recurrenceEndDate,
    guestPermissions: state.guestPermissions,
  }), [
    state.activityType, state.title, state.date, state.startTime, state.duration, state.allDay,
    state.description, state.location, state.reminderMinutes, state.visibility, state.participants,
    state.linkedEntities, state.recurrenceEnabled, state.recurrenceDays, state.recurrenceEndType,
    state.recurrenceCount, state.recurrenceEndDate, state.guestPermissions,
  ])
  const initialSnapshotRef = React.useRef<string | null>(null)
  const snapshotOpenKeyRef = React.useRef<string | null>(null)
  const snapshotSettleCountRef = React.useRef(0)
  const openKey = open ? `${editData?.id ?? 'new'}` : null
  React.useEffect(() => {
    if (!open) {
      initialSnapshotRef.current = null
      snapshotOpenKeyRef.current = null
      snapshotSettleCountRef.current = 0
      return
    }
    if (snapshotOpenKeyRef.current !== openKey) {
      snapshotOpenKeyRef.current = openKey
      snapshotSettleCountRef.current = 0
      initialSnapshotRef.current = null
    }
    if (snapshotSettleCountRef.current < 2) {
      initialSnapshotRef.current = formSnapshot
      snapshotSettleCountRef.current += 1
    }
  }, [open, openKey, formSnapshot])

  const isDirty = React.useCallback(() => {
    if (initialSnapshotRef.current == null) return false
    return initialSnapshotRef.current !== formSnapshot
  }, [formSnapshot])

  const guardedClose = React.useCallback(async () => {
    if (!isDirty()) {
      onClose()
      return
    }
    const ok = await confirm({
      title: t('customers.schedule.discardConfirm.title', 'Discard unsaved changes?'),
      description: t(
        'customers.schedule.discardConfirm.description',
        'You have unsaved edits in this activity. Save them first or continue to discard them.',
      ),
      confirmText: t('customers.schedule.discardConfirm.confirm', 'Discard'),
      cancelText: t('customers.schedule.discardConfirm.cancel', 'Keep editing'),
      variant: 'destructive',
    })
    if (ok) onClose()
  }, [confirm, isDirty, onClose, t])

  const mutationContextId = React.useMemo(
    () => `customer-activity:${entityType}:${entityId}`,
    [entityId, entityType],
  )
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    entityType: 'company' | 'person' | 'deal'
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: mutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })
  const mutationContext = React.useMemo(
    () => ({
      formId: mutationContextId,
      resourceKind:
        entityType === 'company'
          ? 'customers.company'
          : entityType === 'person'
            ? 'customers.person'
            : 'customers.deal',
      resourceId: entityId,
      entityType,
      retryLastMutation,
    }),
    [entityId, entityType, mutationContextId, retryLastMutation],
  )
  const runGuardedMutation = React.useCallback(
    async <T,>(operation: () => Promise<T>, mutationPayload: Record<string, unknown>) =>
      runMutation({
        operation,
        mutationPayload,
        context: mutationContext,
      }),
    [mutationContext, runMutation],
  )

  // Conflict detection -- debounced check when date/time/duration changes
  React.useEffect(() => {
    if (!open || state.allDay || !state.date || !state.startTime) {
      state.setConflict(null)
      return
    }
    const timer = setTimeout(async () => {
      try {
        const localStart = new Date(`${state.date}T${state.startTime}:00`)
        const params = new URLSearchParams({
          date: state.date,
          startTime: state.startTime,
          duration: String(state.duration),
        })
        if (editData?.id) {
          params.set('excludeId', editData.id)
        }
        if (!Number.isNaN(localStart.getTime())) {
          params.set('timezoneOffsetMinutes', String(-localStart.getTimezoneOffset()))
        }
        const data = await readApiResultOrThrow<{
          hasConflicts: boolean
          conflicts: Array<{ id: string; title: string | null; startTime: string; endTime: string; type: string }>
        }>(`/api/customers/interactions/conflicts?${params.toString()}`)
        if (data?.hasConflicts && Array.isArray(data.conflicts) && data.conflicts.length > 0) {
          const descriptions = data.conflicts
            .map((c) => `${c.startTime}–${c.endTime}: ${c.title ?? c.type}`)
            .join(', ')
          state.setConflict(
            t('customers.schedule.conflict.description', 'Overlaps with: {{items}}', { items: descriptions }),
          )
        } else {
          state.setConflict(null)
        }
      } catch {
        state.setConflict(null)
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [editData?.id, open, state.date, state.startTime, state.duration, state.allDay, t]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = React.useCallback(async () => {
    if (!state.title.trim()) return
    state.setSaving(true)
    try {
      const scheduledAt = state.allDay
        ? new Date(`${state.date}T00:00:00`).toISOString()
        : new Date(`${state.date}T${state.startTime}:00`).toISOString()

      const recurrenceRule = state.recurrenceEnabled
        ? buildRecurrenceRule(state.recurrenceDays, state.recurrenceEndType, state.recurrenceCount, state.recurrenceEndDate)
        : null

      const isEditing = Boolean(editData?.id)
      const payload = {
        ...(isEditing ? { id: editData!.id } : {}),
        entityId,
        dealId,
        interactionType: state.activityType,
        title: state.title.trim(),
        body: state.description.trim() || null,
        status: 'planned',
        scheduledAt,
        durationMinutes: visibleFields.has('duration') && !state.allDay ? state.duration : null,
        location: visibleFields.has('location') ? (state.location.trim() || null) : null,
        allDay: visibleFields.has('allDay') ? state.allDay : null,
        recurrenceRule: visibleFields.has('recurrence') ? recurrenceRule : null,
        recurrenceEnd: visibleFields.has('recurrence') && state.recurrenceEndType === 'date' && state.recurrenceEndDate
          ? new Date(state.recurrenceEndDate).toISOString()
          : null,
        participants: visibleFields.has('participants') && state.participants.length > 0
          ? state.participants.map((p) => ({ userId: p.userId, name: p.name, email: p.email, status: p.status ?? 'pending' }))
          : null,
        guestPermissions: visibleFields.has('participants') && state.participants.length > 0 ? state.guestPermissions : null,
        linkedEntities: state.linkedEntities.length > 0
          ? state.linkedEntities.map((e) => ({ id: e.id, type: e.type, label: e.label }))
          : null,
        reminderMinutes: visibleFields.has('reminder') ? state.reminderMinutes : null,
        visibility: visibleFields.has('visibility') ? state.visibility : null,
      }
      await runGuardedMutation(
        () =>
          apiCallOrThrow('/api/customers/interactions', {
            method: isEditing ? 'PUT' : 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          }),
        {
          operation: isEditing ? 'updateActivity' : 'createActivity',
          interactionId: editData?.id ?? null,
          interactionType: state.activityType,
        },
      )
      flash(t('customers.schedule.saved', 'Activity scheduled'), 'success')
      onClose()
      // Delay data reload so the dialog can unmount cleanly and Radix restores body scroll
      requestAnimationFrame(() => { onActivityCreated?.() })
    } catch {
      flash(t('customers.schedule.error', 'Failed to schedule activity'), 'error')
    } finally {
      state.setSaving(false)
    }
  }, [state.activityType, state.allDay, state.date, state.description, dealId, state.duration, editData, entityId, state.guestPermissions, state.linkedEntities, state.location, onActivityCreated, onClose, state.participants, state.recurrenceCount, state.recurrenceDays, state.recurrenceEnabled, state.recurrenceEndDate, state.recurrenceEndType, state.reminderMinutes, runGuardedMutation, state.startTime, t, state.title, state.visibility, visibleFields]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleKeyDown = React.useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    }
  }, [handleSave])

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) void guardedClose() }}>
      {ConfirmDialogElement}
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden border-border p-0 shadow-xl sm:max-w-[680px] sm:rounded-xl [&>[data-dialog-close]]:hidden" onKeyDown={handleKeyDown} aria-describedby={undefined}>
        <VisuallyHidden>
          <DialogTitle>{editData ? t('customers.schedule.editTitle', 'Edit activity') : t('customers.schedule.title', 'Schedule activity')}</DialogTitle>
        </VisuallyHidden>

        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border bg-background px-6 py-5">
          <div className="flex flex-col gap-1.5">
            <h2 className="text-lg font-bold leading-tight text-foreground">
              {editData ? t('customers.schedule.editTitle', 'Edit activity') : t('customers.schedule.title', 'Schedule activity')}
            </h2>
            {entityName && (
              <div className="flex items-center gap-1.5">
                <span className="inline-block size-3.5 rounded-full bg-status-success-icon shrink-0" />
                <span className="text-xs text-muted-foreground">
                  {t('customers.schedule.context', 'On timeline: {{name}}', { name: entityName })}
                  {companyName && ` · ${companyName}`}
                </span>
              </div>
            )}
          </div>
          <IconButton type="button" variant="ghost" size="sm" onClick={() => { void guardedClose() }} className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-background" aria-label={t('customers.schedule.cancel', 'Cancel')}>
            <X className="size-4 text-muted-foreground" />
          </IconButton>
        </div>

        <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-4 bg-background p-6">

        {/* Conflict warning */}
        {state.conflict && (
          <Alert variant="warning" className="rounded-lg">
            <AlertTriangle className="size-5" />
            <AlertTitle>
              {t('customers.schedule.conflict.title', 'Calendar conflict')}
            </AlertTitle>
            <AlertDescription>{state.conflict}</AlertDescription>
          </Alert>
        )}

        {/* Type tabs */}
        <div className="flex gap-0.5 rounded-md border border-border bg-muted p-1">
          {TYPE_TABS.map(({ type, icon: Icon, labelKey, fallback }) => {
            const isActive = state.activityType === type
            return (
              <Button
                key={type}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => state.setActivityType(type)}
                className={cn(
                  'h-auto flex items-center gap-2 rounded-md px-3.5 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-background font-semibold text-foreground shadow-sm'
                    : 'bg-transparent font-normal text-muted-foreground',
                )}
              >
                <Icon className="size-3.5" />
                {t(labelKey, fallback)}
              </Button>
            )
          })}
        </div>

        {/* Title */}
        <div className="flex flex-col gap-1.5">
          <label className="text-overline font-semibold text-muted-foreground tracking-wider">
            {getFieldLabel(state.activityType, 'title', t, 'customers.schedule.titleLabel', 'Title')}
          </label>
          <input
            type="text"
            value={state.title}
            onChange={(e) => state.setTitle(e.target.value)}
            placeholder={t('customers.schedule.titlePlaceholder', 'Activity title...')}
            className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-foreground"
            autoFocus
          />
        </div>

        {/* Date/Time/Duration */}
        <DateTimeFields
          visible={visibleFields}
          activityType={state.activityType}
          date={state.date}
          setDate={state.setDate}
          startTime={state.startTime}
          setStartTime={state.setStartTime}
          duration={state.duration}
          setDuration={state.setDuration}
          allDay={state.allDay}
          setAllDay={state.setAllDay}
          recurrenceEnabled={state.recurrenceEnabled}
          setRecurrenceEnabled={state.setRecurrenceEnabled}
          recurrenceDays={state.recurrenceDays}
          toggleRecurrenceDay={state.toggleRecurrenceDay}
          recurrenceEndType={state.recurrenceEndType}
          setRecurrenceEndType={state.setRecurrenceEndType}
          recurrenceCount={state.recurrenceCount}
          setRecurrenceCount={state.setRecurrenceCount}
          recurrenceEndDate={state.recurrenceEndDate}
          setRecurrenceEndDate={state.setRecurrenceEndDate}
        />

        {/* Participants */}
        <ParticipantsField
          visible={visibleFields}
          activityType={state.activityType}
          participants={state.participants}
          setParticipants={state.setParticipants}
          removeParticipant={state.removeParticipant}
          guestPermissions={state.guestPermissions}
          setGuestPermissions={state.setGuestPermissions}
        />

        {/* Location */}
        <LocationField
          visible={visibleFields}
          activityType={state.activityType}
          location={state.location}
          setLocation={state.setLocation}
        />

        {/* Linked Entities */}
        <LinkedEntitiesField
          visible={visibleFields}
          activityType={state.activityType}
          linkedEntities={state.linkedEntities}
          setLinkedEntities={state.setLinkedEntities}
        />

        {/* Description */}
        <div>
          <label className="text-overline font-semibold uppercase text-muted-foreground tracking-wider">
            {getFieldLabel(state.activityType, 'description', t, 'customers.schedule.description', 'Description')}
          </label>
          <div className="mt-[8px]">
            <SwitchableMarkdownInput
              value={state.description}
              onChange={state.setDescription}
              isMarkdownEnabled={state.markdownEnabled}
              height={120}
              placeholder={t('customers.schedule.descriptionPlaceholder', 'Add details...')}
            />
          </div>
        </div>

        {/* Reminder + Visibility */}
        <FooterFields
          visible={visibleFields}
          activityType={state.activityType}
          reminderMinutes={state.reminderMinutes}
          setReminderMinutes={state.setReminderMinutes}
          visibility={state.visibility}
          setVisibility={state.setVisibility}
        />

        </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-end gap-2.5 border-t border-border bg-muted/50 px-6 py-4">
          <Button type="button" variant="outline" onClick={() => { void guardedClose() }} className="rounded-md border border-input bg-background px-5 py-3 text-sm font-semibold text-foreground">
            {t('customers.schedule.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={handleSave} disabled={state.saving || !state.title.trim()} className="flex items-center gap-2 rounded-md bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">
            <Calendar className="size-3.5" />
            {state.saving
              ? t('customers.schedule.saving', 'Saving...')
              : editData
                ? t('customers.schedule.update', 'Update activity')
                : t('customers.schedule.save', 'Save activity')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export type { ScheduleActivityEditData }

function buildRecurrenceRule(
  days: boolean[],
  endType: 'never' | 'count' | 'date',
  count: number,
  endDate: string,
): string {
  const dayNames = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
  const selectedDays = days.map((active, i) => (active ? dayNames[i] : null)).filter(Boolean)
  let rule = `FREQ=WEEKLY;BYDAY=${selectedDays.join(',')}`
  if (endType === 'count') rule += `;COUNT=${count}`
  if (endType === 'date' && endDate) rule += `;UNTIL=${endDate.replace(/-/g, '')}T235959Z`
  return rule
}
