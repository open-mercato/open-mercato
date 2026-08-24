'use client'

import { Bell, Eye } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectTriggerLeading,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import type { ActivityType, ScheduleFieldId } from './fieldConfig'
import { isVisible, getFieldLabel } from './fieldConfig'

const REMINDER_OPTIONS = [0, 5, 10, 15, 30, 60, 240, 1440]

function formatReminderLabel(
  minutes: number,
  t: (key: string, fallback: string, params?: Record<string, string | number>) => string,
): string {
  if (minutes === 0) return t('customers.schedule.reminder.none', 'None')
  if (minutes >= 1440) {
    const days = Math.round(minutes / 1440)
    return days === 1
      ? t('customers.schedule.reminder.dayBefore', '1 day before')
      : t('customers.schedule.reminder.daysBefore', '{days} days before', { days })
  }
  if (minutes >= 60) {
    const hours = Math.round(minutes / 60)
    return hours === 1
      ? t('customers.schedule.reminder.hourBefore', '1 hour before')
      : t('customers.schedule.reminder.hoursBefore', '{hours} hours before', { hours })
  }
  return t('customers.schedule.reminder.minutesBefore', '{minutes} min before', { minutes })
}

interface FooterFieldsProps {
  visible: Set<ScheduleFieldId>
  activityType: ActivityType
  reminderMinutes: number
  setReminderMinutes: (value: number) => void
  visibility: string
  setVisibility: (value: string) => void
}

export function FooterFields({
  visible,
  activityType,
  reminderMinutes,
  setReminderMinutes,
  visibility,
  setVisibility,
}: FooterFieldsProps) {
  const t = useT()

  const showReminder = isVisible(activityType, 'reminder')
  const showVisibility = isVisible(activityType, 'visibility')

  if (!showReminder && !showVisibility) return null

  return (
    <div className="flex gap-3">
      {showReminder && (
        <div className="flex flex-1 flex-col gap-1.5">
          <label className="text-sm font-medium">
            {getFieldLabel(activityType, 'reminder', t, 'customers.schedule.reminder', 'Reminder')}
          </label>
          <Select
            value={String(reminderMinutes)}
            onValueChange={(next) => setReminderMinutes(Number(next))}
          >
            <SelectTrigger className="h-10">
              <SelectTriggerLeading><Bell /></SelectTriggerLeading>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REMINDER_OPTIONS.map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {formatReminderLabel(m, t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {showVisibility && (
        <div className="flex flex-1 flex-col gap-1.5">
          <label className="text-sm font-medium">
            {getFieldLabel(activityType, 'visibility', t, 'customers.schedule.visibility', 'Visibility')}
          </label>
          <Select value={visibility} onValueChange={setVisibility}>
            <SelectTrigger className="h-10">
              <SelectTriggerLeading><Eye /></SelectTriggerLeading>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="team">{t('customers.schedule.visibility.team', 'Team only')}</SelectItem>
              <SelectItem value="public">{t('customers.schedule.visibility.public', 'Public')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  )
}
