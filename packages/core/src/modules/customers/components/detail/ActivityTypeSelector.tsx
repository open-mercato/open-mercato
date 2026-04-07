'use client'
import * as React from 'react'
import { Phone, Mail, Handshake, StickyNote } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'

const ACTIVITY_TYPES = [
  { type: 'call', icon: Phone, labelKey: 'customers.activityComposer.types.call' },
  { type: 'email', icon: Mail, labelKey: 'customers.activityComposer.types.email' },
  { type: 'meeting', icon: Handshake, labelKey: 'customers.activityComposer.types.meeting' },
  { type: 'note', icon: StickyNote, labelKey: 'customers.activityComposer.types.note' },
] as const

export type ActivityType = (typeof ACTIVITY_TYPES)[number]['type']

interface ActivityTypeSelectorProps {
  selectedType: ActivityType | null
  onSelect: (type: ActivityType) => void
}

export function ActivityTypeSelector({ selectedType, onSelect }: ActivityTypeSelectorProps) {
  const t = useT()

  return (
    <div className="flex items-center gap-1">
      {ACTIVITY_TYPES.map(({ type, icon: Icon, labelKey }) => (
        <IconButton
          key={type}
          type="button"
          variant={selectedType === type ? 'outline' : 'ghost'}
          size="sm"
          onClick={() => onSelect(type)}
          aria-label={t(labelKey)}
          aria-pressed={selectedType === type}
          className={cn(
            selectedType === type && 'border-primary bg-primary/5 text-primary'
          )}
        >
          <Icon className="size-4" />
        </IconButton>
      ))}
    </div>
  )
}

export { ACTIVITY_TYPES }
