'use client'

import { Bell, Eye, ChevronDown } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ActivityType, ScheduleFieldId } from './fieldConfig'
import { isVisible, getFieldLabel } from './fieldConfig'

const REMINDER_OPTIONS = [0, 5, 10, 15, 30, 60]

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
    <div className="flex gap-[12px]">
      {showReminder && (
        <div className="flex flex-1 flex-col gap-[6px]">
          <label className="text-[11px] font-semibold text-muted-foreground tracking-[0.5px]">
            {getFieldLabel(activityType, 'reminder', t, 'customers.schedule.reminder', 'Reminder')}
          </label>
          <div className="flex items-center gap-[8px] rounded-[8px] border border-border bg-background px-[12px] py-[10px]">
            <Bell className="size-[14px] text-muted-foreground" />
            <select
              value={reminderMinutes}
              onChange={(e) => setReminderMinutes(Number(e.target.value))}
              className="flex-1 appearance-none bg-transparent text-[13px] text-foreground focus:outline-none"
            >
              {REMINDER_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? t('customers.schedule.reminder.none', 'None') : `${m} min`}
                </option>
              ))}
            </select>
            <ChevronDown className="size-[14px] text-muted-foreground" />
          </div>
        </div>
      )}
      {showVisibility && (
        <div className="flex flex-1 flex-col gap-[6px]">
          <label className="text-[11px] font-semibold text-muted-foreground tracking-[0.5px]">
            {getFieldLabel(activityType, 'visibility', t, 'customers.schedule.visibility', 'Visibility')}
          </label>
          <div className="flex items-center gap-[8px] rounded-[8px] border border-border bg-background px-[12px] py-[10px]">
            <Eye className="size-[14px] text-muted-foreground" />
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value)}
              className="flex-1 appearance-none bg-transparent text-[13px] text-foreground focus:outline-none"
            >
              <option value="team">{t('customers.schedule.visibility.team', 'Team only')}</option>
              <option value="public">{t('customers.schedule.visibility.public', 'Public')}</option>
            </select>
            <ChevronDown className="size-[14px] text-muted-foreground" />
          </div>
        </div>
      )}
    </div>
  )
}
