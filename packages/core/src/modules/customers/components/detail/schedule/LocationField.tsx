'use client'

import { MapPin } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ActivityType, ScheduleFieldId } from './fieldConfig'
import { isVisible, getFieldLabel } from './fieldConfig'

interface LocationFieldProps {
  visible: Set<ScheduleFieldId>
  activityType: ActivityType
  location: string
  setLocation: (value: string) => void
}

export function LocationField({
  visible,
  activityType,
  location,
  setLocation,
}: LocationFieldProps) {
  const t = useT()

  if (!isVisible(activityType, 'location')) return null

  return (
    <div className="flex flex-col gap-[6px]">
      <label className="text-overline font-semibold text-muted-foreground tracking-[0.5px]">
        {getFieldLabel(activityType, 'location', t, 'customers.schedule.location', 'Location')}
      </label>
      <div className="flex items-center gap-[8px] rounded-[8px] border border-border bg-background px-[12px] py-[10px]">
        <MapPin className="size-[14px] text-muted-foreground shrink-0" />
        <input
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder={t('customers.schedule.locationPlaceholder', 'Add location or meeting link...')}
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
      </div>
    </div>
  )
}
