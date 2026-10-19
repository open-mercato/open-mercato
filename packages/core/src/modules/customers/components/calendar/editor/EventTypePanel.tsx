"use client"

import * as React from 'react'
import { z } from 'zod'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { registerComponent } from '@open-mercato/shared/modules/widgets/component-registry'
import { useRegisteredComponent } from '@open-mercato/ui/backend/injection/useRegisteredComponent'
import type { CalendarEventTypePanelProps, EffectiveCalendarEventType } from '../../../calendar-event-types'
import { defaultRepeatDaysForDateInput, type EditorFormState } from '../../../lib/calendar/editorPayload'
import { extensionPoints } from '../../../extension-points'
import { Field } from './inputs'
import { LocationField } from './LocationField'
import { PeopleField } from './PeopleField'
import { PriorityField } from './PriorityField'
import { RepeatField } from './RepeatField'
import { ResourcesField } from './ResourcesField'
import { ScheduleSection } from './ScheduleSection'
import { eventTypeConfig } from './useEventTypeCatalog'

const PEOPLE_FIELD_TEXT = {
  attendees: { labelKey: 'customers.calendar.editor.attendees', label: 'Attendees', placeholderKey: 'customers.calendar.editor.addPeoplePlaceholder', placeholder: 'Add staff or customer…' },
  participants: { labelKey: 'customers.calendar.editor.participants', label: 'Participants', placeholderKey: 'customers.calendar.editor.addPeoplePlaceholder', placeholder: 'Add staff or customer…' },
  to: { labelKey: 'customers.calendar.editor.to', label: 'To', placeholderKey: 'customers.calendar.editor.addRecipientPlaceholder', placeholder: 'Add recipient…' },
} as const

const MemoScheduleSection = React.memo(ScheduleSection)
const MemoRepeatField = React.memo(RepeatField)
const MemoPeopleField = React.memo(PeopleField)
const MemoLocationField = React.memo(LocationField)
const MemoResourcesField = React.memo(ResourcesField)
const MemoPriorityField = React.memo(PriorityField)

export function DefaultEventTypePanel({ definition, values, errors, disabled, capabilities, setValue }: CalendarEventTypePanelProps) {
  const t = useT()
  const form = values as unknown as EditorFormState
  const config = eventTypeConfig(definition)
  // The handlers read the latest draft through a ref so their identities depend
  // only on `setValue`. Every field below is memoized, so a keystroke in an
  // unrelated field (title, description) re-renders none of them.
  const formRef = React.useRef(form)
  formRef.current = form
  const handlers = React.useMemo(() => {
    const update = (patch: Partial<EditorFormState>) => {
      for (const [key, value] of Object.entries(patch)) setValue(key, value)
    }
    return {
      allDay: (allDay: boolean) => update({ allDay }),
      date: (date: string) => {
        const current = formRef.current
        const untouchedDefault = JSON.stringify(current.repeatDays) === JSON.stringify(defaultRepeatDaysForDateInput(current.date))
        update(untouchedDefault ? { date, repeatDays: defaultRepeatDaysForDateInput(date) } : { date })
      },
      startTime: (startTime: string) => update({ startTime }),
      endDate: (endDate: string) => update({ endDate }),
      endTime: (endTime: string) => update({ endTime }),
      repeatFreq: (repeatFreq: EditorFormState['repeatFreq']) => update(repeatFreq === 'weekly'
        ? { repeatFreq, repeatDays: defaultRepeatDaysForDateInput(formRef.current.date) }
        : { repeatFreq }),
      repeatDay: (index: number) => update({
        repeatDays: formRef.current.repeatDays.map((active, dayIndex) => dayIndex === index ? !active : active),
      }),
      repeatEndType: (repeatEndType: EditorFormState['repeatEndType']) => update({ repeatEndType }),
      repeatCount: (repeatCount: number) => update({ repeatCount }),
      repeatUntilDate: (repeatUntilDate: string) => update({ repeatUntilDate }),
      participants: (participants: EditorFormState['participants']) => update({ participants }),
      assignee: (entries: EditorFormState['participants']) => {
        const next = entries[entries.length - 1] ?? null
        update({ assigneeUserId: next?.userId ?? null, assigneeName: next?.name ?? null })
      },
      location: (location: string) => update({ location }),
      resources: (resources: EditorFormState['resources']) => update({ resources }),
      priority: (priority: EditorFormState['priority']) => update({ priority }),
    }
  }, [setValue])
  const phoneContactIds = React.useMemo(() => {
    const ids: string[] = []
    if (form.relatedTo && form.relatedTo.kind !== 'company') ids.push(form.relatedTo.id)
    for (const participant of form.participants) {
      if (participant.isCustomer && participant.userId) ids.push(participant.userId)
    }
    return Array.from(new Set(ids))
  }, [form.relatedTo, form.participants])
  const assigneeValue = React.useMemo(
    () => form.assigneeUserId
      ? [{ userId: form.assigneeUserId, name: form.assigneeName ?? form.assigneeUserId, isCustomer: false }]
      : [],
    [form.assigneeUserId, form.assigneeName],
  )
  const priorityLabels = React.useMemo(() => ({
    low: t('customers.calendar.editor.priority.low', 'Low'),
    medium: t('customers.calendar.editor.priority.medium', 'Medium'),
    high: t('customers.calendar.editor.priority.high', 'High'),
  }), [t])

  return (
    <fieldset disabled={disabled} className="grid min-w-0 grid-cols-1 items-start gap-4 border-0 p-0 lg:grid-cols-2 lg:gap-x-6">
      <div className="flex w-full flex-col gap-4">
        <MemoScheduleSection
          dateLabel={config.dateLabel}
          hasAllDay={config.hasAllDay}
          hasEnd={config.hasEnd}
          allDay={form.allDay}
          date={form.date}
          startTime={form.startTime}
          endDate={form.endDate}
          endTime={form.endTime}
          startError={errors.startTime ?? errors.date}
          endsError={errors.ends}
          disabled={disabled}
          onAllDayChange={handlers.allDay}
          onDateChange={handlers.date}
          onStartTimeChange={handlers.startTime}
          onEndDateChange={handlers.endDate}
          onEndTimeChange={handlers.endTime}
        />
        {config.hasRepeat ? (
          <MemoRepeatField
            freq={form.repeatFreq}
            days={form.repeatDays}
            endType={form.repeatEndType}
            count={form.repeatCount}
            untilDate={form.repeatUntilDate}
            untilError={errors.repeatUntilDate}
            disabled={disabled}
            onFreqChange={handlers.repeatFreq}
            onToggleDay={handlers.repeatDay}
            onEndTypeChange={handlers.repeatEndType}
            onCountChange={handlers.repeatCount}
            onUntilDateChange={handlers.repeatUntilDate}
          />
        ) : null}
        {config.people && config.people !== 'assignee' ? (
          <Field label={t(PEOPLE_FIELD_TEXT[config.people].labelKey, PEOPLE_FIELD_TEXT[config.people].label)}>
            <MemoPeopleField
              mode="multi"
              includeCustomers
              includeStaff={capabilities.staffEnabled}
              placeholder={t(PEOPLE_FIELD_TEXT[config.people].placeholderKey, PEOPLE_FIELD_TEXT[config.people].placeholder)}
              ariaLabel={t(PEOPLE_FIELD_TEXT[config.people].labelKey, PEOPLE_FIELD_TEXT[config.people].label)}
              value={form.participants}
              onChange={handlers.participants}
              disabled={disabled}
            />
          </Field>
        ) : null}
        {config.people === 'assignee' && capabilities.staffEnabled ? (
          <Field label={t('customers.calendar.editor.assignee', 'Assignee')} error={errors.assignee}>
            <MemoPeopleField
              mode="single"
              includeCustomers={false}
              includeStaff
              placeholder={t('customers.calendar.editor.assigneePlaceholder', 'Assign to a team member…')}
              ariaLabel={t('customers.calendar.editor.assignee', 'Assignee')}
              value={assigneeValue}
              onChange={handlers.assignee}
              disabled={disabled}
            />
          </Field>
        ) : null}
      </div>
      <div className="flex w-full flex-col gap-4">
        {config.location ? (
          <MemoLocationField
            variant={config.location}
            value={form.location}
            onChange={handlers.location}
            phoneContactIds={phoneContactIds}
            disabled={disabled}
          />
        ) : null}
        {capabilities.resourcesEnabled && definition.behavior.fields.resources ? (
          <Field label={t('customers.calendar.editor.resources', 'Resources')}>
            <MemoResourcesField
              placeholder={t('customers.calendar.editor.resourcesPlaceholder', 'Add a resource…')}
              ariaLabel={t('customers.calendar.editor.resources', 'Resources')}
              value={form.resources}
              onChange={handlers.resources}
              disabled={disabled}
            />
          </Field>
        ) : null}
        {config.hasPriority ? (
          <Field label={t('customers.calendar.editor.priority.label', 'Priority')}>
            <MemoPriorityField
              value={form.priority}
              ariaLabel={t('customers.calendar.editor.priority.label', 'Priority')}
              labels={priorityLabels}
              onChange={handlers.priority}
              disabled={disabled}
            />
          </Field>
        ) : null}
      </div>
    </fieldset>
  )
}

const callbackSchema = z.custom<CalendarEventTypePanelProps['setValue']>(
  (value) => typeof value === 'function',
  { message: '[internal] expected a field setter' },
)

const eventTypePanelPropsSchema: z.ZodType<CalendarEventTypePanelProps> = z.object({
  definition: z.custom<EffectiveCalendarEventType>((value) => value !== null && typeof value === 'object'),
  panelKey: z.string().optional(),
  mode: z.enum(['create', 'edit']),
  values: z.record(z.string(), z.unknown()),
  errors: z.record(z.string(), z.string().optional()),
  disabled: z.boolean(),
  capabilities: z.object({ resourcesEnabled: z.boolean(), staffEnabled: z.boolean() }),
  setValue: callbackSchema,
})

registerComponent<CalendarEventTypePanelProps>({
  id: extensionPoints.hosts.calendarEventTypePanel.componentId,
  component: DefaultEventTypePanel,
  metadata: {
    module: 'customers',
    description: 'Calendar event editor type-specific panel.',
    propsSchema: eventTypePanelPropsSchema,
  },
})

export function EventTypePanel(props: CalendarEventTypePanelProps) {
  const Resolved = useRegisteredComponent<CalendarEventTypePanelProps>(
    extensionPoints.hosts.calendarEventTypePanel.componentId,
    DefaultEventTypePanel,
  )
  return <Resolved {...props} />
}
