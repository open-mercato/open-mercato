"use client"

import * as React from 'react'
import { Calendar, X } from 'lucide-react'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { extractOptimisticLockConflict } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { CrudForm, type CrudFormGroup, type CrudFormGroupComponentProps } from '@open-mercato/ui/backend/CrudForm'
import { useInjectionWidgets } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { projectCalendarCustomValues, useCalendarCustomFields, validateCalendarCustomValues } from './editor/useCalendarCustomFields'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { calendarDayEndInstant, calendarDayStartInstant, calendarWallTimeToInstant, calendarTimezoneOptions, defaultCalendarTimezone, isCalendarTimezone } from '../../lib/calendar/timezone'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import { E } from '#generated/entities.ids.generated'
import {
  buildRecurrenceRule,
  buildInteractionPayload,
  computeDurationMinutes,
  createDefaultFormState,
  parseItemToFormState,
  resolveSavedOwnerUserId,
  type EditorFormState,
} from '../../lib/calendar/editorPayload'
import type { ConflictScope } from '../../lib/calendar/preferences'
import { renderDictionaryIcon } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import { normalizeCustomFieldSubmitValue } from '../detail/customFieldUtils'
import type { CalendarItem } from './types'
import { EDITOR_SCROLL_EVENT, Field } from './editor/inputs'
import { SegmentGroup } from './editor/SegmentGroup'
import { RelatedToField } from './editor/RelatedToField'
import { useConflictProbe, useEditorLabelResolution } from './editor/hooks'
import { CalendarDiscardDialog } from './CalendarDiscardDialog'
import { EventTypePanel } from './editor/EventTypePanel'
import { eventTypeConfig, eventTypeOptions, isSelectableEventType, selectedEventType, useEventTypeCatalog } from './editor/useEventTypeCatalog'
import type { ScopedCalendarEventType } from '../../lib/calendar/eventTypeResolver'

export interface CalendarEventEditorProps {
  open: boolean
  mode: 'create' | 'edit'
  item?: CalendarItem | null
  defaultDate?: Date
  defaultRange?: { start: Date; end: Date } | null
  /** @deprecated Event-type labels are loaded from the scoped catalog. */
  typeLabels?: Record<string, string>
  typeIcons?: Record<string, string | null>
  conflictScope?: ConflictScope
  currentUserId?: string | null
  resourcesEnabled?: boolean
  staffEnabled?: boolean
  onOpenChange(open: boolean): void
  onSaved(): void
}

const FORM_ID = 'customers-calendar-event-editor'
const INTERACTION_INJECTION_SPOT = `crud-form:${E.customers.customer_interaction.replace(/:/g, '.')}`

// CrudForm values carry the flattened EditorFormState keys (seeded via
// initialValues) plus cf_* custom-field keys managed by CrudForm itself.
function formStateOfValues(values: Record<string, unknown>): EditorFormState {
  return values as unknown as EditorFormState
}

function customFieldInitialValues(item: CalendarItem): Record<string, unknown> {
  const customValues = (item.raw as Record<string, unknown>).customValues
  if (!customValues || typeof customValues !== 'object' || Array.isArray(customValues)) return {}
  return Object.fromEntries(
    Object.entries(customValues as Record<string, unknown>).map(([key, value]) => [`cf_${key}`, value]),
  )
}

function typeChangeDiscardFields(error: unknown): string[] | null {
  if (!error || typeof error !== 'object') return null
  const details = error as { status?: unknown; code?: unknown; fields?: unknown }
  if (details.status !== 409 || details.code !== 'calendar_type_change_confirmation_required') return null
  if (!Array.isArray(details.fields) || details.fields.length === 0 ||
    !details.fields.every((field) => typeof field === 'string' && field.length > 0)) return null
  return details.fields
}

type EditorBodyProps = {
  ctx: CrudFormGroupComponentProps
  open: boolean
  isEdit: boolean
  item?: CalendarItem | null
  conflictScope: ConflictScope
  currentUserId: string | null
  resourcesEnabled: boolean
  staffEnabled: boolean
  saving: boolean
  catalogItems: readonly ScopedCalendarEventType[]
  catalogReady: boolean
  catalogError: boolean
  onRetryCatalog(): void
  onSelectedTypeChange(key: string): void
}

function EditorBody({
  ctx,
  open,
  isEdit,
  item,
  conflictScope,
  currentUserId,
  resourcesEnabled,
  staffEnabled,
  saving,
  catalogItems,
  catalogReady,
  catalogError,
  onRetryCatalog,
  onSelectedTypeChange,
}: EditorBodyProps) {
  const t = useT()
  const { setValue, errors } = ctx
  const form = formStateOfValues(ctx.values)
  const selectedType = form.category ?? form.kind
  const definition = selectedEventType(catalogItems, selectedType)
  const config = eventTypeConfig(definition)

  const update = React.useCallback(
    (patch: Partial<EditorFormState>) => {
      for (const [key, value] of Object.entries(patch)) setValue(key, value)
    },
    [setValue],
  )

  useEditorLabelResolution(open, form, update)
  // Probe against the owner the interaction will actually be SAVED with so the
  // editor warning matches the grid's post-save conflict rings: tasks own via
  // their assignee, other kinds stay ownerless on create / keep the existing
  // owner on edit (conflicts then come from shared participants).
  const draftOwnerUserId = resolveSavedOwnerUserId(config, form, isEdit, item?.ownerUserId ?? null)
  // Self-exclude by the underlying interaction id (raw.id): findEditorConflictItems
  // drops candidates by raw.id, and every expanded occurrence of a recurring series
  // shares it — so the edited record never conflicts with itself.
  const conflict = useConflictProbe(open, form, config, isEdit && item ? item.raw.id : null, draftOwnerUserId, conflictScope, currentUserId)

  const typeOptions = React.useMemo(
    () => eventTypeOptions(catalogItems, selectedType, t),
    [catalogItems, selectedType, t],
  )
  const typeSwitcherOptions = React.useMemo(
    () =>
      typeOptions.map((option) => ({
        value: option.value,
        label: option.label,
        icon: renderDictionaryIcon(option.icon, 'h-4 w-4'),
      })),
    [typeOptions],
  )

  const titleLabel = form.kind === 'email'
    ? t('customers.calendar.editor.titleLabel.email', 'Subject')
    : form.kind === 'note'
      ? t('customers.calendar.editor.titleLabel.note', 'Note')
      : t('customers.calendar.editor.titleLabel.generic', 'Title')

  return (
    <div className="grid w-full grid-cols-1 items-start gap-4 lg:grid-cols-2 lg:gap-x-6">
      {conflict ? (
        <Alert status="warning" className="rounded-lg lg:col-span-2">
          <AlertTitle>{t('customers.calendar.editor.conflictTitle', 'Calendar conflict')}</AlertTitle>
          <AlertDescription>{conflict}</AlertDescription>
        </Alert>
      ) : null}
      {!catalogReady ? (
        <Alert status={catalogError ? 'error' : 'information'} className="rounded-lg lg:col-span-2">
          <AlertDescription>
            {catalogError
              ? t('customers.calendar.editor.catalogLoadFailed')
              : t('customers.calendar.editor.catalogLoading')}
          </AlertDescription>
          {catalogError ? (
            <Button type="button" variant="outline" onClick={onRetryCatalog}>
              {t('customers.calendar.errors.retry')}
            </Button>
          ) : null}
        </Alert>
      ) : null}
      {catalogReady && (definition.historical || catalogItems.some((item) => item.key === selectedType && !item.selectable)) ? (
        <Alert status="warning" className="rounded-lg lg:col-span-2">
          <AlertDescription>{t('customers.calendar.editor.historicalType')}</AlertDescription>
        </Alert>
      ) : null}
      <div className="w-full lg:col-span-2">
        <SegmentGroup<string>
          ariaLabel={t('customers.calendar.editor.typeSwitcher', 'Event type')}
          value={selectedType}
          onChange={(type) => {
            const nextDefinition = selectedEventType(catalogItems, type)
            update({ kind: nextDefinition.behavior.baseKind, category: type })
            onSelectedTypeChange(type)
          }}
          disabled={!catalogReady}
          options={typeSwitcherOptions}
        />
      </div>
      <Field label={titleLabel} error={errors.title} className="lg:col-span-2">
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
      <Field label={t('customers.calendar.editor.timezone', 'Time zone')} error={errors.timezone}>
        <Select value={form.timezone ?? defaultCalendarTimezone()} onValueChange={(timezone) => update({ timezone })} disabled={saving}>
          <SelectTrigger aria-label={t('customers.calendar.editor.timezone', 'Time zone')}><SelectValue /></SelectTrigger>
          <SelectContent>{calendarTimezoneOptions(form.timezone).map((timezone) => <SelectItem key={timezone} value={timezone}>{timezone}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <div className="lg:col-span-2">
        <Field label={t('customers.calendar.editor.relatedTo', 'Related to')} error={errors.relatedTo}>
          <RelatedToField
            label={t('customers.calendar.editor.relatedTo', 'Related to')}
            value={form.relatedTo}
            deal={form.dealId && form.dealLabel ? { id: form.dealId, label: form.dealLabel } : null}
            onChange={(relatedTo) => update({ relatedTo })}
            onDealChange={(deal) => update({ dealId: deal?.id ?? null, dealLabel: deal?.label ?? null })}
            error={errors.relatedTo}
          />
        </Field>
      </div>
      {catalogReady ? (
        <div className="lg:col-span-2">
          <EventTypePanel
            definition={definition}
            panelKey={definition.panelKey}
            mode={isEdit ? 'edit' : 'create'}
            values={ctx.values}
            errors={errors}
            disabled={saving}
            capabilities={{ resourcesEnabled, staffEnabled }}
            setValue={setValue}
          />
        </div>
      ) : null}
      <Field label={t('customers.calendar.editor.description', 'Description')} className="lg:col-span-2">
        <Textarea
          value={form.description}
          onChange={(event) => update({ description: event.target.value })}
          placeholder={t('customers.calendar.editor.descriptionPlaceholder', 'Add details…')}
          aria-label={t('customers.calendar.editor.description', 'Description')}
          className="h-20 resize-none"
        />
      </Field>
    </div>
  )
}

export function CalendarEventEditor({
  open,
  mode,
  item,
  defaultDate,
  defaultRange,
  conflictScope,
  currentUserId,
  resourcesEnabled,
  staffEnabled,
  onOpenChange,
  onSaved,
}: CalendarEventEditorProps) {
  const t = useT()
  const [saving, setSaving] = React.useState(false)
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const dirtyRef = React.useRef(false)
  const [discardOpen, setDiscardOpen] = React.useState(false)
  const requestClose = React.useCallback(() => {
    if (saving) return
    if (dirtyRef.current) setDiscardOpen(true)
    else onOpenChange(false)
  }, [onOpenChange, saving])
  React.useEffect(() => { if (!open) { dirtyRef.current = false; setDiscardOpen(false) } }, [open])
  const isEdit = mode === 'edit' && Boolean(item?.id)
  const catalog = useEventTypeCatalog(open)
  const [selectedTypeKey, setSelectedTypeKey] = React.useState(() => isEdit && item ? item.interactionType : 'meeting')
  const autoSelectedCreateType = !isEdit && catalog.status === 'ready' && !isSelectableEventType(catalog.items, 'meeting')
    ? catalog.items.find((entry) => entry.selectable && !entry.historical) ?? null
    : null

  // CrudForm reads initialValues once, so every dialog open gets a fresh form
  // instance keyed by the open sequence + edited record.
  const [openSeq, setOpenSeq] = React.useState(0)
  const wasOpenRef = React.useRef(false)
  React.useEffect(() => {
    if (open && !wasOpenRef.current) setOpenSeq((seq) => seq + 1)
    wasOpenRef.current = open
  }, [open])
  const formKey = `${mode}:${item?.id ?? 'new'}:${openSeq}:${autoSelectedCreateType?.key ?? 'default'}`

  const initialValues = React.useMemo<Record<string, unknown>>(() => {
    if (isEdit && item) {
      return {
        ...parseItemToFormState(item),
        ...customFieldInitialValues(item),
        id: item.id,
        updatedAt: item.updatedAt ?? undefined,
      }
    }
    const defaults = createDefaultFormState(defaultDate ?? null, undefined, defaultRange ?? null)
    if (!autoSelectedCreateType) return { ...defaults }
    return {
      ...defaults,
      kind: autoSelectedCreateType.behavior.baseKind,
      category: autoSelectedCreateType.key,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openSeq re-seeds defaults per dialog open
  }, [isEdit, item, defaultDate, defaultRange, openSeq, autoSelectedCreateType])
  const initialTypeKey = String(initialValues.category ?? initialValues.kind ?? 'meeting')
  React.useEffect(() => { setSelectedTypeKey(initialTypeKey) }, [initialTypeKey, formKey])
  const selectedDefinition = selectedEventType(catalog.items, selectedTypeKey)
  const customFields = useCalendarCustomFields(open, E.customers.customer_interaction, selectedDefinition.behavior.customFieldsetIds)
  const injectionWidgets = useInjectionWidgets(INTERACTION_INJECTION_SPOT)
  const canCreateType = isSelectableEventType(catalog.items, selectedTypeKey)

  const handleSubmit = React.useCallback(
    async (values: Record<string, unknown>) => {
      const form = formStateOfValues(values)
      if (catalog.status !== 'ready' || customFields.status !== 'ready' || injectionWidgets.loading || injectionWidgets.error) {
        throw createCrudFormError(t('customers.calendar.editor.catalogLoadFailed'))
      }
      const definition = selectedEventType(catalog.items, form.category ?? form.kind)
      const selectedKey = form.category ?? form.kind
      if ((mode === 'create' || selectedKey !== initialTypeKey) &&
        !isSelectableEventType(catalog.items, selectedKey)) {
        throw createCrudFormError(t('customers.calendar.editor.typeUnavailable'))
      }
      const config = eventTypeConfig(definition)
      const fieldErrors: Record<string, string> = {}
      const timezone = form.timezone ?? defaultCalendarTimezone()
      const startTime = form.allDay && config.hasAllDay ? '00:00' : form.startTime
      if (!isCalendarTimezone(timezone)) fieldErrors.timezone = t('customers.calendar.editor.validation.timezoneInvalid', 'Choose a valid time zone')
      else if (!(form.allDay && config.hasAllDay ? calendarDayStartInstant(form.date, timezone) : calendarWallTimeToInstant(form.date, startTime, timezone))) {
        fieldErrors[form.allDay && config.hasAllDay ? 'date' : 'startTime'] = t('customers.calendar.editor.validation.timezoneGap', 'This local time does not exist in the selected time zone')
      }
      if (config.hasEnd && !form.allDay && isCalendarTimezone(timezone) && !calendarWallTimeToInstant(form.endDate, form.endTime, timezone)) {
        fieldErrors.ends = t('customers.calendar.editor.validation.timezoneGap', 'This local time does not exist in the selected time zone')
      }
      if (config.hasRepeat && form.repeatFreq !== 'none' && isCalendarTimezone(timezone) && form.repeatEndType === 'date' && form.repeatUntilDate && !calendarDayEndInstant(form.repeatUntilDate, timezone)) {
        fieldErrors.repeatUntilDate = t('customers.calendar.editor.validation.timezoneGap', 'This local time does not exist in the selected time zone')
      }
      if (!form.title.trim()) {
        fieldErrors.title = t('customers.calendar.editor.validation.titleRequired', 'Title is required')
      }
      if (!form.relatedTo) {
        fieldErrors.relatedTo = t('customers.calendar.editor.validation.relatedToRequired', 'Select a person or company to link this event')
      }
      if (!fieldErrors.ends && !fieldErrors.startTime && !fieldErrors.date && config.hasEnd && !form.allDay && computeDurationMinutes(form) === null) {
        fieldErrors.ends = t('customers.calendar.editor.validation.endsBeforeStarts', 'End must be after start')
      }
      // A task must be assigned to a team member — surface the requirement inline
      // instead of letting the save fail with no visible reason (#3747 feedback).
      if (config.people === 'assignee' && staffEnabled !== false && !form.assigneeUserId) {
        fieldErrors.assignee = t('customers.calendar.editor.validation.assigneeRequired', 'Assign this task to a team member')
      }
      if (Object.keys(fieldErrors).length > 0) {
        throw createCrudFormError(Object.values(fieldErrors)[0], fieldErrors)
      }
      const customValidation = validateCalendarCustomValues(values, customFields.definitions)
      if (!customValidation.ok) {
        const translatedErrors = Object.fromEntries(Object.entries(customValidation.fieldErrors).map(([key, message]) => [key, t(message, message)]))
        throw createCrudFormError(Object.values(translatedErrors)[0], translatedErrors)
      }
      setSaving(true)
      try {
        const payload = buildInteractionPayload({ ...form, timezone }, {
          config,
          mode,
          id: item?.id,
          resourcesEnabled: resourcesEnabled === true,
          staffEnabled: staffEnabled !== false,
        })
        payload.enforceSelectableType = true
        const applicable = definition.behavior.fields
        const time = form.allDay && applicable.allDay ? '00:00' : form.startTime
        payload.time = time
        payload.scheduledAt = (form.allDay && applicable.allDay ? calendarDayStartInstant(form.date, timezone) : calendarWallTimeToInstant(form.date, time, timezone))!.toISOString()
        payload.timezone = timezone
        payload.allDay = applicable.allDay ? form.allDay : null
        payload.durationMinutes = applicable.endTime && !(form.allDay && applicable.allDay) ? computeDurationMinutes(form) : null
        payload.location = applicable.location === 'none' ? null : form.location.trim() || null
        const recurrenceRule = applicable.recurrence ? buildRecurrenceRule(form) : null
        payload.recurrenceRule = recurrenceRule
        payload.recurrenceEnd = recurrenceRule && form.repeatEndType === 'date' && form.repeatUntilDate
          ? calendarDayEndInstant(form.repeatUntilDate, timezone)!.toISOString()
          : null
        payload.participants = applicable.people !== 'none' && applicable.people !== 'assignee' && form.participants.length
          ? form.participants.map((participant) => ({
              userId: participant.userId,
              name: participant.name,
              email: participant.email,
              status: participant.isCustomer ? 'customer' : 'pending',
            }))
          : null
        if (applicable.people === 'assignee' && staffEnabled !== false) payload.ownerUserId = form.assigneeUserId ?? null
        else delete payload.ownerUserId
        if (applicable.priority) payload.priority = form.priority === 'low' ? 10 : form.priority === 'high' ? 90 : 50
        else delete payload.priority
        if (!applicable.resources) delete payload.linkedEntities
        const custom = collectCustomFieldValues(projectCalendarCustomValues(values, customFields.definitions), {
          transform: (value) => normalizeCustomFieldSubmitValue(value),
        })
        for (const [key, value] of Object.entries(custom)) payload[`cf_${key}`] = value
        // CrudForm supplies the optimistic-lock header (auto-derived from
        // initialValues.updatedAt) via scoped request headers around onSubmit.
        const submitInteraction = (confirmDiscardInapplicableValues: boolean) => apiCallOrThrow('/api/customers/interactions', {
          method: isEdit ? 'PUT' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(confirmDiscardInapplicableValues
            ? { ...payload, confirmDiscardInapplicableValues: true }
            : payload),
        })
        try {
          await submitInteraction(false)
        } catch (error) {
          const fields = typeChangeDiscardFields(error)
          if (!fields) throw error
          const approved = await confirm({
            title: t('customers.calendar.editor.discardTitle'),
            text: `${t('customers.calendar.editor.discardDescription')} ${t('customers.calendar.editor.discardFields')} ${fields.map((field) => {
              const definition = customFields.allDefinitions.find((entry) => `cf_${entry.key}` === field)
              if (definition?.label) return definition.label
              const labelKeys: Record<string, string> = {
                location: 'customers.calendar.editor.location',
                participants: 'customers.calendar.editor.attendees',
                linkedEntities: 'customers.calendar.editor.resources',
                allDay: 'customers.calendar.editor.allDay',
                durationMinutes: 'customers.calendar.editor.dates.ends',
                priority: 'customers.calendar.editor.priority.label',
                recurrenceRule: 'customers.calendar.editor.repeat.label',
                recurrenceEnd: 'customers.calendar.editor.repeat.ends',
              }
              return t(labelKeys[field] ?? 'customers.calendar.editor.discardUnknownField')
            }).join(', ')}`,
            confirmText: t('customers.calendar.editor.discardConfirm'),
            cancelText: t('customers.calendar.editor.cancel'),
            variant: 'destructive',
          })
          if (!approved) return
          await submitInteraction(true)
        }
        flash(t('customers.calendar.editor.saved', 'Event saved'), 'success')
        onOpenChange(false)
        requestAnimationFrame(() => { onSaved() })
      } catch (err) {
        // Surface an optimistic-lock 409 as the persistent conflict bar and
        // close — the bar renders at page level, behind the dialog overlay.
        if (extractOptimisticLockConflict(err)) {
          surfaceRecordConflict(err, t)
          onOpenChange(false)
          return
        }
        throw err
      } finally {
        setSaving(false)
      }
    },
    [catalog, customFields, injectionWidgets.loading, injectionWidgets.error, confirm, initialTypeKey, isEdit, item?.id, mode, onOpenChange, onSaved, resourcesEnabled, staffEnabled, t],
  )

  const groups = React.useMemo<CrudFormGroup[]>(
    () => [
      {
        id: 'details',
        bare: true,
        component: (ctx) => (
          <EditorBody
            ctx={ctx}
            open={open}
            isEdit={isEdit}
            item={item}
            conflictScope={conflictScope ?? 'all'}
            currentUserId={currentUserId ?? null}
            resourcesEnabled={resourcesEnabled === true}
            staffEnabled={staffEnabled !== false}
            saving={saving}
            catalogItems={catalog.items}
            catalogReady={catalog.status === 'ready'}
            catalogError={catalog.status === 'error'}
            onRetryCatalog={catalog.retry}
            onSelectedTypeChange={setSelectedTypeKey}
          />
        ),
      },
      ...(customFields.fields.length ? [{ id: 'customFields', title: t('entities.customFields.title'), fields: customFields.fields.map((field) => field.id) }] : []),
    ],
    [open, isEdit, item, conflictScope, currentUserId, resourcesEnabled, staffEnabled, saving, catalog, customFields.fields, t],
  )

  const handleKeyDown = useDialogKeyHandler({
    onCancel: () => { void requestClose() },
    onConfirm: () => {
      const formElement = document.getElementById(FORM_ID)
      if (formElement instanceof HTMLFormElement) formElement.requestSubmit()
    },
    disabled: saving || customFields.status !== 'ready' || injectionWidgets.loading || !!injectionWidgets.error || catalog.status !== 'ready' || (mode === 'create' && !canCreateType),
  })

  const dialogTitle = isEdit ? t('customers.calendar.editor.title.edit', 'Edit event') : t('customers.calendar.editor.title.create', 'New event')

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (nextOpen) onOpenChange(true); else void requestClose() }}>
      <DialogContent
        onKeyDown={handleKeyDown}
        // Only dismiss on a genuine click OUTSIDE the whole editor. Radix
        // relays a click inside the dialog (but outside an open DS
        // DatePicker/Select popover) up to the dialog as an "interact
        // outside" event when it dismisses that popover — without this guard
        // it would tear down the entire editor. Keep it open when the target
        // is inside the dialog body or inside any portalled popover.
        onInteractOutside={(event) => {
          const target = event.detail.originalEvent.target as HTMLElement | null
          if (target?.closest('[data-dialog-content]') || target?.closest('[data-radix-popper-content-wrapper]')) {
            event.preventDefault()
          }
        }}
        aria-describedby={undefined}
        dismissible={false}
        className="flex h-dvh max-h-dvh w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 bg-background p-0 shadow-xl sm:h-auto sm:max-h-[calc(100dvh-4rem)] sm:w-full sm:max-w-lg sm:rounded-2xl sm:border-0 lg:max-w-3xl"
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
            onClick={() => { void requestClose() }}
            aria-label={t('customers.calendar.editor.close', 'Close')}
            className="shrink-0 text-muted-foreground"
          >
            <X aria-hidden className="size-5" />
          </IconButton>
        </div>
        <div
          className="flex-1 overflow-y-auto"
          onScroll={() => {
            // Tell the DS date/time fields to close their (controlled) popover
            // so a portalled popover doesn't float over the form or drift away
            // from its field while scrolling (#3747 feedback). Radix ignores
            // synthetic dismiss events, so the fields drive their own `open`.
            document.dispatchEvent(new CustomEvent(EDITOR_SCROLL_EVENT))
          }}
        >
          <div className="px-4 py-4 sm:px-6 sm:py-5">
            <CrudForm<Record<string, unknown>>
              key={formKey}
              formId={FORM_ID}
              embedded
              trackDirtyWhenEmbedded
              onDirtyChange={(dirty) => { dirtyRef.current = dirty }}
              hideFooterActions
              customFieldsManageMode="page"
              fields={customFields.fields}
              groups={groups}
              initialValues={initialValues}
              injectionSpotId={INTERACTION_INJECTION_SPOT}
              onSubmit={handleSubmit}
            />
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
            type="submit"
            form={FORM_ID}
            disabled={saving || customFields.status !== 'ready' || injectionWidgets.loading || !!injectionWidgets.error || catalog.status !== 'ready' || (mode === 'create' && !canCreateType)}
          >
            {saving ? t('customers.calendar.editor.saving', 'Saving…') : t('customers.calendar.editor.save', 'Save event')}
          </Button>
        </div>
      </DialogContent>
      <CalendarDiscardDialog open={discardOpen} onKeepEditing={() => setDiscardOpen(false)} onDiscard={() => {
        setDiscardOpen(false)
        onOpenChange(false)
      }} />
      {ConfirmDialogElement}
    </Dialog>
  )
}
