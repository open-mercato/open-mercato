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

export function DefaultEventTypePanel({ definition, values, errors, disabled, capabilities, setValue }: CalendarEventTypePanelProps) {
  const t = useT()
  const form = values as unknown as EditorFormState
  const config = eventTypeConfig(definition)
  const update = (patch: Partial<EditorFormState>) => {
    for (const [key, value] of Object.entries(patch)) setValue(key, value)
  }
  const phoneContactIds: string[] = []
  if (form.relatedTo && form.relatedTo.kind !== 'company') phoneContactIds.push(form.relatedTo.id)
  for (const participant of form.participants) {
    if (participant.isCustomer && participant.userId) phoneContactIds.push(participant.userId)
  }

  return (
    <fieldset disabled={disabled} className="grid min-w-0 grid-cols-1 items-start gap-4 border-0 p-0 lg:grid-cols-2 lg:gap-x-6">
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
          startError={errors.startTime ?? errors.date}
          endsError={errors.ends}
          disabled={disabled}
          onAllDayChange={(allDay) => update({ allDay })}
          onDateChange={(date) => {
            const untouchedDefault = JSON.stringify(form.repeatDays) === JSON.stringify(defaultRepeatDaysForDateInput(form.date))
            update(untouchedDefault ? { date, repeatDays: defaultRepeatDaysForDateInput(date) } : { date })
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
            untilError={errors.repeatUntilDate}
            disabled={disabled}
            onFreqChange={(repeatFreq) => update(repeatFreq === 'weekly'
              ? { repeatFreq, repeatDays: defaultRepeatDaysForDateInput(form.date) }
              : { repeatFreq })}
            onToggleDay={(index) => update({ repeatDays: form.repeatDays.map((active, dayIndex) => dayIndex === index ? !active : active) })}
            onEndTypeChange={(repeatEndType) => update({ repeatEndType })}
            onCountChange={(repeatCount) => update({ repeatCount })}
            onUntilDateChange={(repeatUntilDate) => update({ repeatUntilDate })}
          />
        ) : null}
        {config.people && config.people !== 'assignee' ? (
          <Field label={t(PEOPLE_FIELD_TEXT[config.people].labelKey, PEOPLE_FIELD_TEXT[config.people].label)}>
            <PeopleField
              mode="multi"
              includeCustomers
              includeStaff={capabilities.staffEnabled}
              placeholder={t(PEOPLE_FIELD_TEXT[config.people].placeholderKey, PEOPLE_FIELD_TEXT[config.people].placeholder)}
              ariaLabel={t(PEOPLE_FIELD_TEXT[config.people].labelKey, PEOPLE_FIELD_TEXT[config.people].label)}
              value={form.participants}
              onChange={(participants) => update({ participants })}
              disabled={disabled}
            />
          </Field>
        ) : null}
        {config.people === 'assignee' && capabilities.staffEnabled ? (
          <Field label={t('customers.calendar.editor.assignee', 'Assignee')} error={errors.assignee}>
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
              disabled={disabled}
            />
          </Field>
        ) : null}
      </div>
      <div className="flex w-full flex-col gap-4">
        {config.location ? (
          <LocationField
            variant={config.location}
            value={form.location}
            onChange={(location) => update({ location })}
            phoneContactIds={Array.from(new Set(phoneContactIds))}
            disabled={disabled}
          />
        ) : null}
        {capabilities.resourcesEnabled && definition.behavior.fields.resources ? (
          <Field label={t('customers.calendar.editor.resources', 'Resources')}>
            <ResourcesField
              placeholder={t('customers.calendar.editor.resourcesPlaceholder', 'Add a resource…')}
              ariaLabel={t('customers.calendar.editor.resources', 'Resources')}
              value={form.resources}
              onChange={(resources) => update({ resources })}
              disabled={disabled}
            />
          </Field>
        ) : null}
        {config.hasPriority ? (
          <Field label={t('customers.calendar.editor.priority.label', 'Priority')}>
            <PriorityField
              value={form.priority}
              ariaLabel={t('customers.calendar.editor.priority.label', 'Priority')}
              labels={{
                low: t('customers.calendar.editor.priority.low', 'Low'),
                medium: t('customers.calendar.editor.priority.medium', 'Medium'),
                high: t('customers.calendar.editor.priority.high', 'High'),
              }}
              onChange={(priority) => update({ priority })}
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
