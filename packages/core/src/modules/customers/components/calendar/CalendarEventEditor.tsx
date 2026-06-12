"use client"

import * as React from 'react'
import { Calendar, X } from 'lucide-react'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader, extractOptimisticLockConflict } from '@open-mercato/ui/backend/utils/optimisticLock'
import { mapCrudServerErrorToFormErrors } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import {
  buildInteractionPayload,
  computeDurationMinutes,
  createDefaultFormState,
  defaultRepeatDaysForDateInput,
  EDITOR_KINDS,
  KIND_CONFIG,
  parseItemToFormState,
  type EditorFormState,
  type EditorKind,
  type EditorPriority,
} from '../../lib/calendar/editorPayload'
import type { CalendarItem } from './types'
import { Field } from './editor/inputs'
import { SegmentGroup } from './editor/SegmentGroup'
import { RelatedToField } from './editor/RelatedToField'
import { CategoryField } from './editor/CategoryField'
import { RepeatField } from './editor/RepeatField'
import { PeopleField } from './editor/PeopleField'
import { ScheduleSection } from './editor/ScheduleSection'
import { LocationField } from './editor/LocationField'
import { useConflictProbe, useEditorLabelResolution } from './editor/hooks'

export interface CalendarEventEditorProps {
  open: boolean
  mode: 'create' | 'edit'
  item?: CalendarItem | null
  defaultDate?: Date
  typeLabels: Record<string, string>
  typeColors: Record<string, string | null>
  onOpenChange(open: boolean): void
  onSaved(): void
}

type FieldErrors = { title?: string; relatedTo?: string; ends?: string }

const PEOPLE_FIELD_TEXT = {
  attendees: { labelKey: 'customers.calendar.editor.attendees', label: 'Attendees', placeholderKey: 'customers.calendar.editor.addPeoplePlaceholder', placeholder: 'Add staff or customer…' },
  participants: { labelKey: 'customers.calendar.editor.participants', label: 'Participants', placeholderKey: 'customers.calendar.editor.addPeoplePlaceholder', placeholder: 'Add staff or customer…' },
  to: { labelKey: 'customers.calendar.editor.to', label: 'To', placeholderKey: 'customers.calendar.editor.addRecipientPlaceholder', placeholder: 'Add recipient…' },
} as const

export function CalendarEventEditor({ open, mode, item, defaultDate, typeLabels, typeColors, onOpenChange, onSaved }: CalendarEventEditorProps) {
  const t = useT()
  const locale = useLocale()
  const [form, setForm] = React.useState<EditorFormState>(() => createDefaultFormState(defaultDate ?? null))
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({})
  const [saving, setSaving] = React.useState(false)
  const openKeyRef = React.useRef<string | null>(null)
  const isEdit = mode === 'edit' && Boolean(item?.id)
  const config = KIND_CONFIG[form.kind]

  const update = React.useCallback((patch: Partial<EditorFormState>) => {
    setForm((previous) => ({ ...previous, ...patch }))
  }, [])

  React.useEffect(() => {
    if (!open) {
      openKeyRef.current = null
      return
    }
    const key = `${mode}:${item?.id ?? 'new'}`
    if (openKeyRef.current === key) return
    openKeyRef.current = key
    setForm(mode === 'edit' && item ? parseItemToFormState(item) : createDefaultFormState(defaultDate ?? null))
    setFieldErrors({})
  }, [open, mode, item, defaultDate])

  useEditorLabelResolution(open, form, update)
  const conflict = useConflictProbe(open, form, config, isEdit && item?.id ? item.id : null)

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: 'customers-calendar-event-editor',
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const handleSave = React.useCallback(async () => {
    const errors: FieldErrors = {}
    if (!form.title.trim()) errors.title = t('customers.calendar.editor.validation.titleRequired', 'Title is required')
    if (!form.relatedTo) errors.relatedTo = t('customers.calendar.editor.validation.relatedToRequired', 'Select a person or company to link this event')
    if (config.hasEnd && !form.allDay && computeDurationMinutes(form) === null) {
      errors.ends = t('customers.calendar.editor.validation.endsBeforeStarts', 'End must be after start')
    }
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return
    setSaving(true)
    try {
      const payload = buildInteractionPayload(form, { mode, id: item?.id })
      await runMutation({
        operation: () => {
          const call = () =>
            apiCallOrThrow('/api/customers/interactions', {
              method: isEdit ? 'PUT' : 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            })
          return isEdit ? withScopedApiRequestHeaders(buildOptimisticLockHeader(item?.updatedAt), call) : call()
        },
        mutationPayload: {
          operation: isEdit ? 'updateCalendarEvent' : 'createCalendarEvent',
          interactionId: item?.id ?? null,
          interactionType: form.category ?? form.kind,
        },
        context: {
          formId: 'customers-calendar-event-editor',
          resourceKind: 'customers.interaction',
          resourceId: item?.id ?? 'new',
          retryLastMutation,
        },
      })
      flash(t('customers.calendar.editor.saved', 'Event saved'), 'success')
      onOpenChange(false)
      requestAnimationFrame(() => { onSaved() })
    } catch (err) {
      // An optimistic-lock 409 is surfaced as the persistent conflict bar by
      // useGuardedMutation (surfaceRecordConflict) — close without re-flashing.
      if (extractOptimisticLockConflict(err)) {
        onOpenChange(false)
        return
      }
      const { message } = mapCrudServerErrorToFormErrors(err)
      const key = typeof message === 'string' ? message.trim() : ''
      flash(key ? t(key, key) : t('customers.calendar.editor.error', 'Failed to save event'), 'error')
    } finally {
      setSaving(false)
    }
  }, [config.hasEnd, form, isEdit, item?.id, mode, onOpenChange, onSaved, retryLastMutation, runMutation, t])

  const handleKeyDown = useDialogKeyHandler({ onConfirm: handleSave, disabled: saving })

  const categoryOptions = React.useMemo(() => {
    const options = Object.entries(typeLabels).map(([value, label]) => ({ value, label }))
    const effective = form.category ?? form.kind
    if (!options.some((option) => option.value === effective)) {
      options.unshift({ value: effective, label: typeLabels[effective] ?? t(`customers.calendar.editor.types.${form.kind}`, form.kind) })
    }
    return options
  }, [typeLabels, form.category, form.kind, t])

  const titleLabel = form.kind === 'email'
    ? t('customers.calendar.editor.titleLabel.email', 'Subject')
    : form.kind === 'note'
      ? t('customers.calendar.editor.titleLabel.note', 'Note')
      : t('customers.calendar.editor.titleLabel.generic', 'Title')
  const dialogTitle = isEdit ? t('customers.calendar.editor.title.edit', 'Edit event') : t('customers.calendar.editor.title.create', 'New event')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onKeyDown={handleKeyDown}
        aria-describedby={undefined}
        dismissible={false}
        className="flex h-dvh max-h-dvh w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 bg-background p-0 shadow-xl sm:h-auto sm:max-h-screen sm:w-full sm:max-w-md sm:rounded-2xl sm:border-0"
      >
        <VisuallyHidden>
          <DialogTitle>{dialogTitle}</DialogTitle>
        </VisuallyHidden>
        <div className="flex shrink-0 items-center gap-3 border-b border-border bg-background py-4 pl-5 pr-4">
          <Calendar aria-hidden className="size-6 shrink-0 text-foreground" strokeWidth={1.75} />
          <p className="min-w-0 flex-1 text-sm font-medium leading-5 text-foreground">{dialogTitle}</p>
          <IconButton
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            aria-label={t('customers.calendar.editor.close', 'Close')}
            className="shrink-0 text-muted-foreground"
          >
            <X aria-hidden className="size-5" />
          </IconButton>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col items-start gap-5 px-4 py-5 sm:px-6 sm:py-6">
            {conflict ? (
              <Alert variant="warning" className="rounded-lg">
                <AlertTitle>{t('customers.calendar.editor.conflictTitle', 'Calendar conflict')}</AlertTitle>
                <AlertDescription>{conflict}</AlertDescription>
              </Alert>
            ) : null}
            <SegmentGroup<EditorKind>
              ariaLabel={t('customers.calendar.editor.typeSwitcher', 'Event type')}
              value={form.kind}
              onChange={(kind) => update({ kind, category: null })}
              options={EDITOR_KINDS.map((kind) => ({ value: kind, label: t(`customers.calendar.editor.types.${kind}`, kind) }))}
            />
            <Field label={titleLabel} error={fieldErrors.title}>
              <Input
                type="text"
                value={form.title}
                onChange={(event) => update({ title: event.target.value })}
                placeholder={t('customers.calendar.editor.titlePlaceholder', 'Add a title…')}
                aria-label={titleLabel}
                autoFocus
                size="lg"
              />
            </Field>
            <Field label={t('customers.calendar.editor.relatedTo', 'Related to')} error={fieldErrors.relatedTo}>
              <RelatedToField
                label={t('customers.calendar.editor.relatedTo', 'Related to')}
                value={form.relatedTo}
                deal={form.dealId && form.dealLabel ? { id: form.dealId, label: form.dealLabel } : null}
                onChange={(relatedTo) => update({ relatedTo })}
                onDealChange={(deal) => update({ dealId: deal?.id ?? null, dealLabel: deal?.label ?? null })}
                error={fieldErrors.relatedTo}
              />
            </Field>
            <ScheduleSection
              dateLabel={config.dateLabel}
              hasAllDay={config.hasAllDay}
              hasEnd={config.hasEnd}
              allDay={form.allDay}
              date={form.date}
              startTime={form.startTime}
              endDate={form.endDate}
              endTime={form.endTime}
              locale={locale}
              endsError={fieldErrors.ends}
              onAllDayChange={(allDay) => update({ allDay })}
              onDateChange={(date) => {
                const untouchedDefault =
                  JSON.stringify(form.repeatDays) === JSON.stringify(defaultRepeatDaysForDateInput(form.date))
                update(
                  untouchedDefault
                    ? { date, repeatDays: defaultRepeatDaysForDateInput(date) }
                    : { date },
                )
              }}
              onStartTimeChange={(startTime) => update({ startTime })}
              onEndDateChange={(endDate) => update({ endDate })}
              onEndTimeChange={(endTime) => update({ endTime })}
            />
            {config.hasRepeat ? (
              <RepeatField
                freq={form.repeatFreq}
                days={form.repeatDays}
                endType={form.repeatEndType}
                count={form.repeatCount}
                untilDate={form.repeatUntilDate}
                locale={locale}
                onFreqChange={(repeatFreq) =>
                  update(
                    repeatFreq === 'weekly'
                      ? { repeatFreq, repeatDays: defaultRepeatDaysForDateInput(form.date) }
                      : { repeatFreq },
                  )}
                onToggleDay={(index) =>
                  update({ repeatDays: form.repeatDays.map((active, dayIndex) => (dayIndex === index ? !active : active)) })}
                onEndTypeChange={(repeatEndType) => update({ repeatEndType })}
                onCountChange={(repeatCount) => update({ repeatCount })}
                onUntilDateChange={(repeatUntilDate) => update({ repeatUntilDate })}
              />
            ) : null}
            <Field label={t('customers.calendar.editor.category', 'Category')}>
              <CategoryField
                label={t('customers.calendar.editor.category', 'Category')}
                value={form.category ?? form.kind}
                options={categoryOptions}
                colors={typeColors}
                onChange={(category) => update({ category })}
              />
            </Field>
            {config.location ? (
              <LocationField variant={config.location} value={form.location} onChange={(location) => update({ location })} />
            ) : null}
            {config.people && config.people !== 'assignee' ? (
              <Field label={t(PEOPLE_FIELD_TEXT[config.people].labelKey, PEOPLE_FIELD_TEXT[config.people].label)}>
                <PeopleField
                  mode="multi"
                  includeCustomers
                  placeholder={t(PEOPLE_FIELD_TEXT[config.people].placeholderKey, PEOPLE_FIELD_TEXT[config.people].placeholder)}
                  ariaLabel={t(PEOPLE_FIELD_TEXT[config.people].labelKey, PEOPLE_FIELD_TEXT[config.people].label)}
                  value={form.participants}
                  onChange={(participants) => update({ participants })}
                />
              </Field>
            ) : null}
            {config.hasPriority ? (
              <Field label={t('customers.calendar.editor.priority.label', 'Priority')}>
                <SegmentGroup<EditorPriority>
                  size="md"
                  ariaLabel={t('customers.calendar.editor.priority.label', 'Priority')}
                  value={form.priority}
                  onChange={(priority) => update({ priority })}
                  options={[
                    { value: 'low', label: t('customers.calendar.editor.priority.low', 'Low') },
                    { value: 'medium', label: t('customers.calendar.editor.priority.medium', 'Medium') },
                    { value: 'high', label: t('customers.calendar.editor.priority.high', 'High') },
                  ]}
                />
              </Field>
            ) : null}
            {config.people === 'assignee' ? (
              <Field label={t('customers.calendar.editor.assignee', 'Assignee')}>
                <PeopleField
                  mode="single"
                  includeCustomers={false}
                  placeholder={t('customers.calendar.editor.assigneePlaceholder', 'Assign to a team member…')}
                  ariaLabel={t('customers.calendar.editor.assignee', 'Assignee')}
                  value={form.assigneeUserId
                    ? [{ userId: form.assigneeUserId, name: form.assigneeName ?? form.assigneeUserId, isCustomer: false }]
                    : []}
                  onChange={(entries) => {
                    const next = entries[entries.length - 1] ?? null
                    update({ assigneeUserId: next?.userId ?? null, assigneeName: next?.name ?? null })
                  }}
                />
              </Field>
            ) : null}
            <Field label={t('customers.calendar.editor.description', 'Description')}>
              <Textarea
                value={form.description}
                onChange={(event) => update({ description: event.target.value })}
                placeholder={t('customers.calendar.editor.descriptionPlaceholder', 'Add details…')}
                aria-label={t('customers.calendar.editor.description', 'Description')}
                className="h-24 resize-none"
              />
            </Field>
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-border bg-background px-5 py-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t('customers.calendar.editor.cancel', 'Cancel')}
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? t('customers.calendar.editor.saving', 'Saving…') : t('customers.calendar.editor.save', 'Save event')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
