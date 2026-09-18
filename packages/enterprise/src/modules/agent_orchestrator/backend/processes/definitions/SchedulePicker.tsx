'use client'

import * as React from 'react'
import { Input } from '@open-mercato/ui/primitives/input'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { readScheduleChoice, scheduleChoiceCron, type ScheduleFrequency } from './scheduleChoices'

export function SchedulePicker({
  cron,
  onChange,
  disabled,
  locale,
}: {
  cron: string
  onChange: (cron: string) => void
  disabled?: boolean
  locale: string
}) {
  const t = useT()
  const parsed = readScheduleChoice(cron)
  const [custom, setCustom] = React.useState(parsed.frequency === 'custom')
  const choice = custom ? { ...parsed, frequency: 'custom' as const } : parsed
  const weekdays = Array.from({ length: 7 }, (_, day) => ({
    value: String(day),
    label: new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(
      new Date(Date.UTC(2026, 0, 4 + day)),
    ),
  }))
  const update = (patch: Partial<typeof choice>) => {
    const next = scheduleChoiceCron({ ...choice, ...patch })
    if (next) onChange(next)
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <FormField
        label={t('agent_orchestrator.processDefinitions.triggers.schedule.frequency')}
        disabled={disabled}
      >
        <Select
          value={choice.frequency}
          onValueChange={(frequency) => {
            setCustom(frequency === 'custom')
            if (frequency !== 'custom') update({ frequency: frequency as ScheduleFrequency })
          }}
        >
          <SelectTrigger aria-label={t('agent_orchestrator.processDefinitions.triggers.schedule.frequency')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(['daily', 'weekdays', 'weekly', 'custom'] as const).map((frequency) => (
              <SelectItem key={frequency} value={frequency}>
                {t(`agent_orchestrator.processDefinitions.triggers.schedule.${frequency}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      {choice.frequency === 'custom' ? (
        <FormField
          label={t('agent_orchestrator.processDefinitions.triggers.schedule.cron')}
          disabled={disabled}
        >
          <Input value={cron} className="font-mono" onChange={(event) => onChange(event.target.value)} />
        </FormField>
      ) : (
        <FormField
          label={t('agent_orchestrator.processDefinitions.triggers.schedule.time')}
          disabled={disabled}
        >
          <Input type="time" value={choice.time} onChange={(event) => update({ time: event.target.value })} />
        </FormField>
      )}
      {choice.frequency === 'weekly' ? (
        <FormField
          label={t('agent_orchestrator.processDefinitions.triggers.schedule.day')}
          disabled={disabled}
        >
          <Select value={choice.weekday} onValueChange={(weekday) => update({ weekday })}>
            <SelectTrigger aria-label={t('agent_orchestrator.processDefinitions.triggers.schedule.day')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {weekdays.map((day) => (
                <SelectItem key={day.value} value={day.value}>
                  {day.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      ) : null}
    </div>
  )
}
