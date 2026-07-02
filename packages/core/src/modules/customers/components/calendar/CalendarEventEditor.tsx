"use client"

import * as React from 'react'
import { ArrowDown, ArrowUp, Calendar, Minus, X } from 'lucide-react'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { extractOptimisticLockConflict } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { CrudForm, type CrudFormGroup, type CrudFormGroupComponentProps } from '@open-mercato/ui/backend/CrudForm'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import { E } from '#generated/entities.ids.generated'
import {
  buildEditorTypeOptions,
  buildInteractionPayload,
  computeDurationMinutes,
  createDefaultFormState,
  defaultRepeatDaysForDateInput,
  editorKindOfInteractionType,
  KIND_CONFIG,
  parseItemToFormState,
  resolveSavedOwnerUserId,
  type EditorFormState,
  type EditorKind,
  type EditorPriority,
} from '../../lib/calendar/editorPayload'
import type { ConflictScope } from '../../lib/calendar/preferences'
import { renderDictionaryIcon } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import { normalizeCustomFieldSubmitValue } from '../detail/customFieldUtils'
import type { CalendarItem } from './types'
import { Field } from './editor/inputs'
import { SegmentGroup } from './editor/SegmentGroup'
import { RelatedToField } from './editor/RelatedToField'
import { RepeatField } from './editor/RepeatField'
import { PeopleField } from './editor/PeopleField'
import { ResourcesField } from './editor/ResourcesField'
import { ScheduleSection } from './editor/ScheduleSection'
import { LocationField } from './editor/LocationField'
import { useConflictProbe, useEditorLabelResolution } from './editor/hooks'

export interface CalendarEventEditorProps {
  open: boolean
  mode: 'create' | 'edit'
  item?: CalendarItem | null
  defaultDate?: Date
  defaultRange?: { start: Date; end: Date } | null
  typeLabels: Record<string, string>
  typeIcons?: Record<string, string | null>
  conflictScope?: ConflictScope
  currentUserId?: string | null
  resourcesEnabled?: boolean
  staffEnabled?: boolean
  onOpenChange(open: boolean): void
  onSaved(): void
}

const FORM_ID = 'customers-calendar-event-editor'
const INTERACTION_ENTITY_IDS = [E.customers.customer_interaction]

const PEOPLE_FIELD_TEXT = {
  attendees: { labelKey: 'customers.calendar.editor.attendees', label: 'Attendees', placeholderKey: 'customers.calendar.editor.addPeoplePlaceholder', placeholder: 'Add staff or customer…' },
  participants: { labelKey: 'customers.calendar.editor.participants', label: 'Participants', placeholderKey: 'customers.calendar.editor.addPeoplePlaceholder', placeholder: 'Add staff or customer…' },
  to: { labelKey: 'customers.calendar.editor.to', label: 'To', placeholderKey: 'customers.calendar.editor.addRecipientPlaceholder', placeholder: 'Add recipient…' },
} as const

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

type EditorBodyProps = {
  ctx: CrudFormGroupComponentProps
  open: boolean
  isEdit: boolean
  item?: CalendarItem | null
  typeLabels: Record<string, string>
  typeIcons: Record<string, string | null>
  conflictScope: ConflictScope
  currentUserId: string | null
  resourcesEnabled: boolean
  staffEnabled: boolean
}

function EditorBody({
  ctx,
  open,
  isEdit,
  item,
  typeLabels,
  typeIcons,
  conflictScope,
  currentUserId,
  resourcesEnabled,
  staffEnabled,
}: EditorBodyProps) {
  const t = useT()
  const locale = useLocale()
  const { setValue, errors } = ctx
  const form = formStateOfValues(ctx.values)
  const config = KIND_CONFIG[form.kind]

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

  const kindLabels = React.useMemo(
    () => ({
      meeting: t('customers.calendar.editor.types.meeting', 'meeting'),
      call: t('customers.calendar.editor.types.call', 'call'),
      email: t('customers.calendar.editor.types.email', 'email'),
      note: t('customers.calendar.editor.types.note', 'note'),
      event: t('customers.calendar.editor.types.event', 'event'),
      task: t('customers.calendar.editor.types.task', 'task'),
    }),
    [t],
  ) satisfies Record<EditorKind, string>

  const selectedType = form.category ?? form.kind
  const typeOptions = React.useMemo(
    () => buildEditorTypeOptions({ typeLabels, typeIcons, selectedValue: selectedType, kindLabels }),
    [typeLabels, typeIcons, selectedType, kindLabels],
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
    // Single column on phones (full-screen sheet). On lg+ the dialog widens and
    // the fields group into two thematic columns: WHEN (schedule + repeat) on
    // the left, CONTEXT (related record, category, location) on the right;
    // people/resources and the task fields pair up below; title, description
    // and the type switcher span both columns.
    <div className="grid w-full grid-cols-1 items-start gap-4 lg:grid-cols-2 lg:gap-x-6">
      {conflict ? (
        <Alert variant="warning" className="rounded-lg lg:col-span-2">
          <AlertTitle>{t('customers.calendar.editor.conflictTitle', 'Calendar conflict')}</AlertTitle>
          <AlertDescription>{conflict}</AlertDescription>
        </Alert>
      ) : null}
      <div className="w-full lg:col-span-2">
        <SegmentGroup<string>
          ariaLabel={t('customers.calendar.editor.typeSwitcher', 'Event type')}
          value={selectedType}
          onChange={(type) => update({ kind: editorKindOfInteractionType(type), category: type })}
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
      <div className="flex w-full flex-col gap-4">
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
        endsError={errors.ends}
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
      </div>
      <div className="flex w-full flex-col gap-4">
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
      {config.location ? (
        <LocationField variant={config.location} value={form.location} onChange={(location) => update({ location })} />
      ) : null}
      </div>
      {config.people && config.people !== 'assignee' ? (
        <Field
          label={t(PEOPLE_FIELD_TEXT[config.people].labelKey, PEOPLE_FIELD_TEXT[config.people].label)}
          className={resourcesEnabled ? undefined : 'lg:col-span-2'}
        >
          <PeopleField
            mode="multi"
            includeCustomers
            includeStaff={staffEnabled}
            placeholder={t(PEOPLE_FIELD_TEXT[config.people].placeholderKey, PEOPLE_FIELD_TEXT[config.people].placeholder)}
            ariaLabel={t(PEOPLE_FIELD_TEXT[config.people].labelKey, PEOPLE_FIELD_TEXT[config.people].label)}
            value={form.participants}
            onChange={(participants) => update({ participants })}
          />
        </Field>
      ) : null}
      {resourcesEnabled ? (
        <Field label={t('customers.calendar.editor.resources', 'Resources')}>
          <ResourcesField
            placeholder={t('customers.calendar.editor.resourcesPlaceholder', 'Add a room, car or equipment…')}
            ariaLabel={t('customers.calendar.editor.resources', 'Resources')}
            value={form.resources}
            onChange={(resources) => update({ resources })}
          />
        </Field>
      ) : null}
      {config.hasPriority ? (
        <Field label={t('customers.calendar.editor.priority.label', 'Priority')}>
          <SegmentedControl
            value={form.priority}
            onValueChange={(priority) => update({ priority: priority as EditorPriority })}
            aria-label={t('customers.calendar.editor.priority.label', 'Priority')}
            className="w-full"
          >
            <SegmentedControlItem value="low" className="flex-1 gap-1.5">
              <ArrowDown aria-hidden className="h-4 w-4 text-status-success-text" />
              {t('customers.calendar.editor.priority.low', 'Low')}
            </SegmentedControlItem>
            <SegmentedControlItem value="medium" className="flex-1 gap-1.5">
              <Minus aria-hidden className="h-4 w-4 text-status-info-text" />
              {t('customers.calendar.editor.priority.medium', 'Medium')}
            </SegmentedControlItem>
            <SegmentedControlItem value="high" className="flex-1 gap-1.5">
              <ArrowUp aria-hidden className="h-4 w-4 text-status-error-text" />
              {t('customers.calendar.editor.priority.high', 'High')}
            </SegmentedControlItem>
          </SegmentedControl>
        </Field>
      ) : null}
      {config.people === 'assignee' && staffEnabled ? (
        <Field label={t('customers.calendar.editor.assignee', 'Assignee')}>
          <PeopleField
            mode="single"
            includeCustomers={false}
            includeStaff
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
  typeLabels,
  typeIcons,
  conflictScope,
  currentUserId,
  resourcesEnabled,
  staffEnabled,
  onOpenChange,
  onSaved,
}: CalendarEventEditorProps) {
  const t = useT()
  const [saving, setSaving] = React.useState(false)
  const isEdit = mode === 'edit' && Boolean(item?.id)

  // CrudForm reads initialValues once, so every dialog open gets a fresh form
  // instance keyed by the open sequence + edited record.
  const [openSeq, setOpenSeq] = React.useState(0)
  const wasOpenRef = React.useRef(false)
  React.useEffect(() => {
    if (open && !wasOpenRef.current) setOpenSeq((seq) => seq + 1)
    wasOpenRef.current = open
  }, [open])
  const formKey = `${mode}:${item?.id ?? 'new'}:${openSeq}`

  const initialValues = React.useMemo<Record<string, unknown>>(() => {
    if (isEdit && item) {
      return {
        ...parseItemToFormState(item),
        ...customFieldInitialValues(item),
        id: item.id,
        updatedAt: item.updatedAt ?? undefined,
      }
    }
    return { ...createDefaultFormState(defaultDate ?? null, undefined, defaultRange ?? null) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openSeq re-seeds defaults per dialog open
  }, [isEdit, item, defaultDate, defaultRange, openSeq])

  const handleSubmit = React.useCallback(
    async (values: Record<string, unknown>) => {
      const form = formStateOfValues(values)
      const config = KIND_CONFIG[form.kind]
      const fieldErrors: Record<string, string> = {}
      if (!form.title.trim()) {
        fieldErrors.title = t('customers.calendar.editor.validation.titleRequired', 'Title is required')
      }
      if (!form.relatedTo) {
        fieldErrors.relatedTo = t('customers.calendar.editor.validation.relatedToRequired', 'Select a person or company to link this event')
      }
      if (config.hasEnd && !form.allDay && computeDurationMinutes(form) === null) {
        fieldErrors.ends = t('customers.calendar.editor.validation.endsBeforeStarts', 'End must be after start')
      }
      if (Object.keys(fieldErrors).length > 0) {
        throw createCrudFormError(Object.values(fieldErrors)[0], fieldErrors)
      }
      setSaving(true)
      try {
        const payload = buildInteractionPayload(form, {
          mode,
          id: item?.id,
          resourcesEnabled: resourcesEnabled === true,
          staffEnabled: staffEnabled !== false,
        })
        const custom = collectCustomFieldValues(values, {
          transform: (value) => normalizeCustomFieldSubmitValue(value),
        })
        for (const [key, value] of Object.entries(custom)) payload[`cf_${key}`] = value
        // CrudForm supplies the optimistic-lock header (auto-derived from
        // initialValues.updatedAt) via scoped request headers around onSubmit.
        await apiCallOrThrow('/api/customers/interactions', {
          method: isEdit ? 'PUT' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
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
    [isEdit, item?.id, mode, onOpenChange, onSaved, resourcesEnabled, staffEnabled, t],
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
            typeLabels={typeLabels}
            typeIcons={typeIcons ?? {}}
            conflictScope={conflictScope ?? 'all'}
            currentUserId={currentUserId ?? null}
            resourcesEnabled={resourcesEnabled === true}
            staffEnabled={staffEnabled !== false}
          />
        ),
      },
      { id: 'customFields', kind: 'customFields' },
    ],
    [open, isEdit, item, typeLabels, typeIcons, conflictScope, currentUserId, resourcesEnabled, staffEnabled],
  )

  const handleKeyDown = useDialogKeyHandler({
    onConfirm: () => {
      const formElement = document.getElementById(FORM_ID)
      if (formElement instanceof HTMLFormElement) formElement.requestSubmit()
    },
    disabled: saving,
  })

  const dialogTitle = isEdit ? t('customers.calendar.editor.title.edit', 'Edit event') : t('customers.calendar.editor.title.create', 'New event')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onKeyDown={handleKeyDown}
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
            onClick={() => onOpenChange(false)}
            aria-label={t('customers.calendar.editor.close', 'Close')}
            className="shrink-0 text-muted-foreground"
          >
            <X aria-hidden className="size-5" />
          </IconButton>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="px-4 py-4 sm:px-6 sm:py-5">
            <CrudForm<Record<string, unknown>>
              key={formKey}
              formId={FORM_ID}
              embedded
              hideFooterActions
              customFieldsManageMode="page"
              fields={[]}
              groups={groups}
              initialValues={initialValues}
              entityIds={INTERACTION_ENTITY_IDS}
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
            disabled={saving}
          >
            {saving ? t('customers.calendar.editor.saving', 'Saving…') : t('customers.calendar.editor.save', 'Save event')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
