'use client'

import { Bell, Eye, ChevronDown } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
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
          <label className="text-overline font-semibold text-muted-foreground tracking-wider">
            {getFieldLabel(activityType, 'reminder', t, 'customers.schedule.reminder', 'Reminder')}
          </label>
          <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2.5">
            <Bell className="size-3.5 text-muted-foreground" />
            <select
              value={reminderMinutes}
              onChange={(e) => setReminderMinutes(Number(e.target.value))}
              className="flex-1 appearance-none bg-transparent text-sm text-foreground focus:outline-none"
            >
              {REMINDER_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {formatReminderLabel(m, t)}
                </option>
              ))}
            </select>
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </div>
        </div>
      )}
      {showVisibility && (
        <div className="flex flex-1 flex-col gap-1.5">
          <label className="text-overline font-semibold text-muted-foreground tracking-wider">
            {getFieldLabel(activityType, 'visibility', t, 'customers.schedule.visibility', 'Visibility')}
          </label>
          <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2.5">
            <Eye className="size-3.5 text-muted-foreground" />
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value)}
              className="flex-1 appearance-none bg-transparent text-sm text-foreground focus:outline-none"
            >
              <option value="team">{t('customers.schedule.visibility.team', 'Team only')}</option>
              <option value="public">{t('customers.schedule.visibility.public', 'Public')}</option>
            </select>
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </div>
        </div>
      )}
    </div>
  )
}
