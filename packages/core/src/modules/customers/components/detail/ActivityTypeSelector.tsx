'use client'
import * as React from 'react'
import { ListTodo, Mail, Phone, StickyNote, Users } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'

const ACTIVITY_TYPES = [
  { type: 'call', icon: Phone, labelKey: 'customers.activityComposer.types.call', fallback: 'Call' },
  { type: 'email', icon: Mail, labelKey: 'customers.activityComposer.types.email', fallback: 'Email' },
  { type: 'meeting', icon: Users, labelKey: 'customers.activityComposer.types.meeting', fallback: 'Meeting' },
  { type: 'note', icon: StickyNote, labelKey: 'customers.activityComposer.types.note', fallback: 'Note' },
  { type: 'task', icon: ListTodo, labelKey: 'customers.activityComposer.types.task', fallback: 'Task' },
] as const

export type ActivityType = (typeof ACTIVITY_TYPES)[number]['type']

interface ActivityTypeSelectorProps {
  selectedType: ActivityType | null
  onSelect: (type: ActivityType) => void
}

export function ActivityTypeSelector({ selectedType, onSelect }: ActivityTypeSelectorProps) {
  const t = useT()

  return (
    <div className="grid grid-cols-5 gap-2">
      {ACTIVITY_TYPES.map(({ type, icon: Icon, labelKey, fallback }) => {
        const isSelected = selectedType === type
        return (
          <Button
            key={type}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onSelect(type)}
            aria-pressed={isSelected}
            className={cn(
              'h-10 gap-2 rounded-lg',
              isSelected
                ? 'border-foreground bg-background text-foreground shadow-sm'
                : 'border-border text-muted-foreground',
            )}
          >
            <Icon className="size-4" />
            {t(labelKey, fallback)}
          </Button>
        )
      })}
    </div>
  )
}

export { ACTIVITY_TYPES }
