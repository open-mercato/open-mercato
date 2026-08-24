'use client'

import { MapPin } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Input } from '@open-mercato/ui/primitives/input'
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
    <div className="flex flex-col gap-1.5">
      <label className="text-overline font-semibold text-muted-foreground tracking-wider">
        {getFieldLabel(activityType, 'location', t, 'customers.schedule.location', 'Location')}
      </label>
      <Input
        type="text"
        size="lg"
        leftIcon={<MapPin />}
        value={location}
        onChange={(e) => setLocation(e.target.value)}
        placeholder={t('customers.schedule.locationPlaceholder', 'Add location or meeting link...')}
      />
    </div>
  )
}
